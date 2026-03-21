#!/bin/bash

# Post-installation script for GeeClaw on Linux

set -e

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database -q /usr/share/applications || true
fi

# Update icon cache
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi

# Create symbolic link for GeeClaw app binary
if [ -x /opt/GeeClaw/geeclaw ]; then
    ln -sf /opt/GeeClaw/geeclaw /usr/local/bin/geeclaw 2>/dev/null || true
fi

# Set chrome-sandbox permissions.
# On systems without working user namespaces, the SUID bit is required.
# On Ubuntu 24.04+, user namespaces are available but blocked by AppArmor;
# we rely on the AppArmor profile below instead, so 0755 is correct there.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # No user namespace support — fall back to SUID sandbox
    chmod 4755 '/opt/GeeClaw/chrome-sandbox' || true
else
    chmod 0755 '/opt/GeeClaw/chrome-sandbox' || true
fi

# Install AppArmor profile (Ubuntu 24.04+).
# Ubuntu 24.04 enables kernel.apparmor_restrict_unprivileged_userns=1 by default,
# which blocks Electron's sandbox. The bundled AppArmor profile grants the 'userns'
# permission so the app can create user namespaces without disabling the global policy.
#
# We first check if AppArmor is enabled and if the running version supports abi/4.0
# (Ubuntu 22.04 does not; it runs fine without the profile, so we skip it there).
if apparmor_status --enabled > /dev/null 2>&1; then
    APPARMOR_PROFILE_SOURCE='/opt/GeeClaw/resources/apparmor-profile'
    APPARMOR_PROFILE_TARGET='/etc/apparmor.d/geeclaw'
    if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
        cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

        # Skip live-loading in a chroot environment (e.g. image-building pipelines).
        if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
            apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
        fi
    else
        echo "Skipping AppArmor profile installation: this version of AppArmor does not support the bundled profile"
    fi
fi

echo "GeeClaw has been installed successfully."
