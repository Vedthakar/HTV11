/*
 * drive_straight.c - drive the RC car straight forward, forever.
 *
 * Hardware: Raspberry Pi + Grove Base Hat + Seeed Grove I2C Motor Driver v1.3
 *           (L298 + ATmega8, I2C address 0x0F). Drive motor on one channel,
 *           steering motor on the other (held at 0 = wheels straight).
 *
 * Build:   make            (or: gcc -O2 -Wall -o drive_straight drive_straight.c)
 * Run:     sudo ./drive_straight                 start now
 *          sudo ./drive_straight --wait-unplug   wait for the Ethernet cable to be pulled
 *          sudo ./drive_straight --test          pulse each motor channel to see which is which
 * Stop:    Ctrl+C, or `sudo systemctl stop drive-straight`, or `sudo pkill drive_straight`.
 *
 * I2C protocol (from Seeed's Grove_I2C_Motor_Driver_v1_3 library):
 *   [0x82, speed_m1, speed_m2]   speed 0..255
 *   [0xAA, direction, 0x01]      2 bits per motor: 0b10 clockwise, 0b01 anticlockwise
 *                                M1 = bits 0-1, M2 = bits 2-3
 *   [0x84, 0x02, 0x01]           PWM frequency 3.9 kHz
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/i2c-dev.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#define CMD_SPEED     0x82
#define CMD_PWM_FREQ  0x84
#define CMD_DIRECTION 0xAA
#define CMD_NOTHING   0x01
#define DIR_CW        0x2
#define DIR_CCW       0x1

struct options {
    const char *device;      /* /dev/i2c-1 */
    int address;             /* 0x0F */
    int speed_pct;           /* 0..100 */
    int drive_channel;       /* 1 or 2 */
    int reverse;             /* flip drive direction */
    int wait_unplug;         /* wait for network cable removal before driving */
    const char *iface;       /* eth0 */
    const char *carrier_path;/* override for testing */
    int start_delay_s;       /* countdown after unplug */
    int run_seconds;         /* 0 = forever */
    int test;                /* channel identification mode */
    int dry_run;             /* print bytes instead of touching I2C */
};

static volatile sig_atomic_t g_stop = 0;
static int g_fd = -1;
static int g_dry = 0;

static void on_signal(int sig) { (void)sig; g_stop = 1; }

static void logf_(const char *fmt, ...) {
    char ts[16];
    time_t now = time(NULL);
    strftime(ts, sizeof ts, "%H:%M:%S", localtime(&now));
    va_list ap;
    va_start(ap, fmt);
    printf("%s ", ts);
    vprintf(fmt, ap);
    printf("\n");
    fflush(stdout);
    va_end(ap);
}

static void sleep_ms(int ms) {
    struct timespec ts = { ms / 1000, (long)(ms % 1000) * 1000000L };
    while (nanosleep(&ts, &ts) == -1 && errno == EINTR && !g_stop) {}
}

/* Send one 3-byte command. The ATmega8 sometimes NAKs; retry a few times. */
static int send3(uint8_t a, uint8_t b, uint8_t c) {
    uint8_t buf[3] = { a, b, c };
    if (g_dry) {
        logf_("i2c write: 0x%02X 0x%02X 0x%02X", a, b, c);
        return 0;
    }
    for (int attempt = 0; attempt < 5; attempt++) {
        if (write(g_fd, buf, 3) == 3) {
            sleep_ms(4); /* the driver needs a moment between commands */
            return 0;
        }
        sleep_ms(10);
    }
    logf_("I2C write failed (0x%02X): %s", a, strerror(errno));
    return -1;
}

/* m1, m2 in -255..255 (sign = direction). */
static int set_motors(int m1, int m2) {
    uint8_t d1 = m1 < 0 ? DIR_CCW : DIR_CW;
    uint8_t d2 = m2 < 0 ? DIR_CCW : DIR_CW;
    int s1 = abs(m1) > 255 ? 255 : abs(m1);
    int s2 = abs(m2) > 255 ? 255 : abs(m2);
    if (send3(CMD_DIRECTION, (uint8_t)(d1 | (d2 << 2)), CMD_NOTHING) < 0) return -1;
    return send3(CMD_SPEED, (uint8_t)s1, (uint8_t)s2);
}

static void stop_motors(void) {
    /* best effort, a few times: this is the safety path */
    for (int i = 0; i < 3; i++)
        if (set_motors(0, 0) == 0) break;
}

static int set_drive(const struct options *o, int drive) {
    return o->drive_channel == 1 ? set_motors(drive, 0) : set_motors(0, drive);
}

static int read_carrier(const char *path) {
    char c = '0';
    int fd = open(path, O_RDONLY);
    if (fd < 0) return 0; /* interface gone (USB unplugged) == down */
    if (read(fd, &c, 1) != 1) c = '0';
    close(fd);
    return c == '1';
}

static void usage(const char *prog) {
    printf("Usage: %s [options]\n"
           "  --speed N          drive power percent, 0-100 (default 90)\n"
           "  --channel 1|2      motor channel the DRIVE motor is on (default 1)\n"
           "  --reverse          flip direction if the car goes backwards\n"
           "  --wait-unplug      wait until the Ethernet cable is pulled, then count down\n"
           "  --iface NAME       network interface to watch (default eth0)\n"
           "  --delay N          seconds to count down after unplug (default 5)\n"
           "  --seconds N        stop after N seconds (default 0 = forever)\n"
           "  --test             pulse channel 1, then channel 2, to identify motors\n"
           "  --device PATH      I2C bus (default /dev/i2c-1)\n"
           "  --address N        I2C address (default 0x0F)\n"
           "  --dry-run          print the I2C bytes instead of sending them\n",
           prog);
}

static int parse_args(int argc, char **argv, struct options *o) {
    for (int i = 1; i < argc; i++) {
        const char *a = argv[i];
        const char *v = i + 1 < argc ? argv[i + 1] : NULL;
#define NEED_VALUE() do { if (!v) { fprintf(stderr, "%s needs a value\n", a); return -1; } i++; } while (0)
        if (!strcmp(a, "--speed"))            { NEED_VALUE(); o->speed_pct = atoi(v); }
        else if (!strcmp(a, "--channel"))     { NEED_VALUE(); o->drive_channel = atoi(v); }
        else if (!strcmp(a, "--reverse"))     { o->reverse = 1; }
        else if (!strcmp(a, "--wait-unplug")) { o->wait_unplug = 1; }
        else if (!strcmp(a, "--iface"))       { NEED_VALUE(); o->iface = v; }
        else if (!strcmp(a, "--carrier-file")){ NEED_VALUE(); o->carrier_path = v; }
        else if (!strcmp(a, "--delay"))       { NEED_VALUE(); o->start_delay_s = atoi(v); }
        else if (!strcmp(a, "--seconds"))     { NEED_VALUE(); o->run_seconds = atoi(v); }
        else if (!strcmp(a, "--test"))        { o->test = 1; }
        else if (!strcmp(a, "--device"))      { NEED_VALUE(); o->device = v; }
        else if (!strcmp(a, "--address"))     { NEED_VALUE(); o->address = (int)strtol(v, NULL, 0); }
        else if (!strcmp(a, "--dry-run"))     { o->dry_run = 1; }
        else if (!strcmp(a, "-h") || !strcmp(a, "--help")) { usage(argv[0]); exit(0); }
        else { fprintf(stderr, "Unknown option: %s\n", a); usage(argv[0]); return -1; }
#undef NEED_VALUE
    }
    if (o->speed_pct < 0 || o->speed_pct > 100) { fprintf(stderr, "--speed must be 0-100\n"); return -1; }
    if (o->drive_channel != 1 && o->drive_channel != 2) { fprintf(stderr, "--channel must be 1 or 2\n"); return -1; }
    if (o->address < 0x03 || o->address > 0x77) { fprintf(stderr, "--address out of range\n"); return -1; }
    if (o->start_delay_s < 0 || o->run_seconds < 0) { fprintf(stderr, "negative times not allowed\n"); return -1; }
    return 0;
}

static int open_bus(const struct options *o) {
    if (o->dry_run) return 0;
    g_fd = open(o->device, O_RDWR);
    if (g_fd < 0) {
        logf_("Can't open %s: %s", o->device, strerror(errno));
        logf_("Is I2C enabled? Run: sudo raspi-config nonint do_i2c 0  (then reboot)");
        return -1;
    }
    if (ioctl(g_fd, I2C_SLAVE, o->address) < 0) {
        logf_("Can't select I2C address 0x%02X: %s", o->address, strerror(errno));
        return -1;
    }
    return 0;
}

static void run_test(void) {
    logf_("TEST: channel 1 forward for 2 s (watch which wheels move)");
    set_motors(200, 0);
    sleep_ms(2000);
    stop_motors();
    if (g_stop) return;
    sleep_ms(1000);
    logf_("TEST: channel 2 forward for 2 s");
    set_motors(0, 200);
    sleep_ms(2000);
    stop_motors();
    logf_("TEST done. The channel that spun the REAR wheels is your --channel.");
}

static int wait_for_unplug(const struct options *o) {
    char path[256];
    if (o->carrier_path) snprintf(path, sizeof path, "%s", o->carrier_path);
    else snprintf(path, sizeof path, "/sys/class/net/%s/carrier", o->iface);

    logf_("Armed. Waiting for the %s cable to be unplugged...", o->iface);
    int down_ms = 0;
    while (!g_stop) {
        if (read_carrier(path)) down_ms = 0;
        else if ((down_ms += 200) >= 1500) break; /* debounce: down for 1.5 s */
        sleep_ms(200);
    }
    if (g_stop) return -1;
    logf_("Cable unplugged.");
    return 0;
}

int main(int argc, char **argv) {
    struct options o = {
        .device = "/dev/i2c-1", .address = 0x0F, .speed_pct = 90, .drive_channel = 1,
        .iface = "eth0", .start_delay_s = 5,
    };
    if (parse_args(argc, argv, &o) < 0) return 2;
    g_dry = o.dry_run;

    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_signal; /* no SA_RESTART: sleeps return early so we stop fast */
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGHUP, &sa, NULL);

    if (open_bus(&o) < 0) return 1;

    /* Talk to the driver once up front so wiring problems show immediately. */
    if (send3(CMD_PWM_FREQ, 0x02, CMD_NOTHING) < 0 || set_motors(0, 0) < 0) {
        logf_("No answer from the motor driver at 0x%02X.", o.address);
        logf_("Check: Grove cable in an I2C port, driver powered (LED on), `i2cdetect -y 1` shows 0f.");
        return 1;
    }
    logf_("Motor driver OK at 0x%02X on %s%s.", o.address, o.device, o.dry_run ? " (dry run)" : "");

    if (o.test) {
        run_test();
        stop_motors();
        if (g_fd >= 0) close(g_fd);
        return 0;
    }

    if (o.wait_unplug && wait_for_unplug(&o) < 0) {
        stop_motors();
        return 0;
    }
    for (int s = o.start_delay_s; s > 0 && !g_stop; s--) {
        logf_("Starting in %d...", s);
        sleep_ms(1000);
    }
    if (g_stop) { /* cancelled during the countdown: never start the motor */
        logf_("Cancelled before starting.");
        stop_motors();
        if (g_fd >= 0) close(g_fd);
        return 0;
    }

    int pwm = (o.speed_pct * 255 + 50) / 100;
    int drive = o.reverse ? -pwm : pwm;
    logf_("Driving straight: channel %d, power %d%% (%d/255)%s, %s.",
          o.drive_channel, o.speed_pct, pwm, o.reverse ? ", reversed" : "",
          o.run_seconds ? "timed" : "forever (Ctrl+C to stop)");

    /* Re-send the command every second so the car recovers if the driver
     * resets (e.g. a brown-out when the motor starts). */
    time_t start = time(NULL);
    int failures = 0;
    while (!g_stop) {
        if (set_drive(&o, drive) < 0) {
            if (++failures % 10 == 1) logf_("Lost contact with motor driver, retrying...");
        } else if (failures) {
            logf_("Motor driver back.");
            failures = 0;
        }
        if (o.run_seconds && time(NULL) - start >= o.run_seconds) break;
        sleep_ms(1000);
    }

    logf_("Stopping motors.");
    stop_motors();
    if (g_fd >= 0) close(g_fd);
    return 0;
}
