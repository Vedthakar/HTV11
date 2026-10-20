#!/bin/bash
# Run ON THE PI from the rc-path/pi folder:  bash install.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(whoami)"
sudo apt-get install -y python3-gpiozero python3-lgpio python3-smbus2 i2c-tools || true

# Grove I2C Motor Driver: enable I2C, and slow it down. The driver's ATmega8 uses
# I2C clock stretching, which the Pi 3/4 I2C hardware handles badly at 100 kHz.
sudo raspi-config nonint do_i2c 0
CFG=/boot/firmware/config.txt; [ -f $CFG ] || CFG=/boot/config.txt
grep -q "i2c_arm_baudrate" $CFG || echo "dtparam=i2c_arm_baudrate=20000" | sudo tee -a $CFG > /dev/null
sudo usermod -aG gpio,i2c "$USER_NAME" || true

sed -e "s#/home/pi/rc-path/pi#$DIR#g" -e "s#User=pi#User=$USER_NAME#" "$DIR/rc-car.service" \
  | sudo tee /etc/systemd/system/rc-car.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable rc-car
echo "Installed. REBOOT once (sudo reboot) so the I2C settings apply."
echo "Then check the motor driver:  i2cdetect -y 1   (should show 0f)"
echo "Logs: journalctl -u rc-car -f"
