# Scheduling (Cron & Timers)

## Phân vai rõ ràng

| Nguồn | Job | Lịch (PT) | Ghi chú |
|-------|-----|-----------|--------|
| **Deploy (systemd/cron)** | Build List | 3:00, 4:00, 5:00 AM | Chạy đúng giờ, không qua AI, tránh timeout |
| **Deploy (systemd/cron)** | Load Campaign | 5:15, 5:45 AM | Chạy đúng giờ, không qua AI |
| **OpenClaw cron (AI)** | Process Replies | 10AM–9PM mỗi giờ | Chỉ AI lo |
| **OpenClaw cron (AI)** | Daily Report | 10PM | Chỉ AI lo |

- **Build-list & Load campaign:** chạy qua **deploy** (systemd timer hoặc crontab), **không** qua OpenClaw agent. Trong `cron/jobs.json` hai job này để `enabled: false`.
- **Process Replies & Daily Report:** chạy qua **OpenClaw cron** (agent). Sau này có thể thay bằng workflow auto khác nếu cần.

---

## Cách 1: Crontab (cron hệ thống)

```bash
cd /home/deploy/openclaw-mvp
./scripts/install-cron.sh
crontab -l   # xem cron đã cài
```

File mẫu: `cron/crontab.example`. Log: `logs/build-list.log`, `logs/load-campaign.log`.

---

## Cách 2: Systemd timers

```bash
./scripts/deploy-timers.sh
systemctl list-timers | grep openclaw
```

---

## Chạy tay (không cần cron)

```bash
./scripts/run-build-list.sh
./scripts/run-load-campaign.sh
```

---

## Đã tự chạy chưa? (kiểm tra trên VPS)

Cần **cả hai** phần sau thì mới tự chạy đủ:

| Phần | Cách bật | Kiểm tra |
|------|----------|----------|
| **Build List + Load Campaign** | **Cách 1:** `./scripts/deploy-timers.sh` (systemd) | `systemctl list-timers \| grep openclaw` |
| | **Cách 2:** `./scripts/install-cron.sh` (crontab) | `crontab -l` |
| **Process Replies + Daily Report** | `./scripts/register-cron-jobs.sh` (OpenClaw cron) | `openclaw cron list` |

**Lưu ý:** Nếu repo trên VPS là `~/OpenClawFlow` (không phải `openclaw-mvp`), dùng **crontab** (Cách 2) vì `install-cron.sh` tự thay đường dẫn repo; systemd service đang ghi cứng `/home/deploy/openclaw-mvp` nên cần sửa file trong `deploy/` hoặc tạo symlink nếu dùng timer.
