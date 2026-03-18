#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${OPENCLAW_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT"

echo "=== Deploying OpenClaw systemd timers ==="

echo "1. Copying service and timer files..."
sudo cp deploy/openclaw-build-list.service /etc/systemd/system/
sudo cp deploy/openclaw-build-list.timer /etc/systemd/system/
sudo cp deploy/openclaw-load-campaign.service /etc/systemd/system/
sudo cp deploy/openclaw-load-campaign.timer /etc/systemd/system/

echo "2. Reloading systemd..."
sudo systemctl daemon-reload

echo "3. Enabling and starting timers..."
sudo systemctl enable --now openclaw-build-list.timer
sudo systemctl enable --now openclaw-load-campaign.timer

echo "4. Verifying timers..."
sudo systemctl list-timers --all | grep openclaw || true

echo ""
echo "=== Done ==="
echo ""
echo "Useful commands:"
echo "  # Check timer status"
echo "  systemctl list-timers | grep openclaw"
echo ""
echo "  # Run build-list manually"
echo "  sudo systemctl start openclaw-build-list.service"
echo "  journalctl -u openclaw-build-list.service -n 50 --no-pager"
echo ""
echo "  # Run load-campaign manually"
echo "  sudo systemctl start openclaw-load-campaign.service"
echo "  journalctl -u openclaw-load-campaign.service -n 50 --no-pager"
echo ""
echo "  # Or run scripts directly (as deploy user):"
echo "  ./scripts/run-build-list.sh"
echo "  ./scripts/run-load-campaign.sh"
