# Drive straight (C test program)

Drives the car straight forward forever. Talks directly to the Grove I2C Motor Driver
(address 0x0F) through `/dev/i2c-1`. No libraries needed beyond the C compiler.

## 1. Copy to the Pi (on the Mac)
```bash
cd ~/Downloads                     # wherever you unzipped rover
scp -r rover pi@raspberrypi.local:~/
ssh pi@raspberrypi.local
```
Replace `pi` with your Pi username if it's different.

## 2. One-time Pi setup
```bash
sudo apt update && sudo apt install -y gcc make i2c-tools
sudo raspi-config nonint do_i2c 0
grep -q i2c_arm_baudrate /boot/firmware/config.txt || echo "dtparam=i2c_arm_baudrate=20000" | sudo tee -a /boot/firmware/config.txt
sudo reboot
```

## 3. Build and check the driver
```bash
cd ~/rover/straight
make
i2cdetect -y 1          # must show "0f" in the grid
```

## 4. Find which channel is the drive motor (wheels in the air!)
```bash
sudo ./drive_straight --test
```
Channel 1 runs for 2 s, then channel 2. The one that spins the **rear** wheels is your drive channel.

## 5. Short test run (wheels still in the air)
```bash
sudo ./drive_straight --channel 1 --seconds 3 --delay 0
```
Use the channel you found. If the wheels spin backwards, add `--reverse`.

## 6. Make it start by itself when you unplug Ethernet
Edit the `ExecStart` line in `drive-straight.service` to your `--channel` (and `--reverse` if needed), then:
```bash
sudo make install
sudo systemctl enable --now drive-straight
journalctl -u drive-straight -f      # watch: "Armed. Waiting for the eth0 cable..."
```
Pull the Ethernet cable, set the car down, it starts 5 seconds later and drives forever.

**To stop it:** pick the car up and unplug the motor USB cable from the power bank.
Or plug Ethernet back in and run `sudo systemctl stop drive-straight`.
To turn the auto-start off: `sudo systemctl disable --now drive-straight`.

## Options
| option | default | |
|---|---|---|
| `--speed N` | 90 | motor power % |
| `--channel 1\|2` | 1 | which terminal the drive motor is on |
| `--reverse` | off | flip direction |
| `--wait-unplug` | off | wait for the Ethernet cable to be pulled |
| `--delay N` | 5 | countdown seconds before driving |
| `--seconds N` | 0 | stop after N seconds (0 = forever) |
| `--test` | | pulse channel 1 then 2 |
| `--dry-run` | | print I2C bytes, don't touch hardware |
