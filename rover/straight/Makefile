CC ?= gcc
CFLAGS ?= -O2 -Wall -Wextra -Werror -std=c11

drive_straight: drive_straight.c
	$(CC) $(CFLAGS) -o $@ $<

install: drive_straight
	sudo install -m 755 drive_straight /usr/local/bin/drive_straight
	sudo install -m 644 drive-straight.service /etc/systemd/system/drive-straight.service
	sudo systemctl daemon-reload
	@echo "Installed. Turn on auto-start with: sudo systemctl enable --now drive-straight"

uninstall:
	-sudo systemctl disable --now drive-straight
	sudo rm -f /usr/local/bin/drive_straight /etc/systemd/system/drive-straight.service
	sudo systemctl daemon-reload

clean:
	rm -f drive_straight

.PHONY: install uninstall clean
