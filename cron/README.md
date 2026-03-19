# Scheduling — Crontab

Tất cả 4 jobs đều chạy qua **system crontab** (không dùng OpenClaw agent cron).

**Nguồn lead:** Không dùng Apollo. Dùng Agent + skill **csv-import** để import CSV vào DB; Bouncer cron sẽ verify lead có sẵn trong DB rồi Load campaign đẩy lên Instantly.

## Lịch chạy (Pacific Time)

| Job | Lịch (PT) | Script | Log |
|-----|-----------|--------|-----|
| Bouncer (verify leads) | 5:00 AM | `run-build-list.sh` | `logs/build-list.log` |
| Load Campaign | 5:30 AM | `run-load-campaign.sh` | `logs/load-campaign.log` |
| Process Replies | 10AM–9PM (mỗi giờ) | `run-process-replies.sh` | `logs/process-replies.log` |
| Daily Report | 10:00 PM | `run-daily-report.sh` | `logs/daily-report.log` |

---

## Cài đặt Crontab

```bash
cd /home/deploy/openclaw-mvp   # hoặc ~/OpenClawFlow
./scripts/install-cron.sh
```

Script tự thay đường dẫn repo cho phù hợp với thư mục hiện tại.

**Kiểm tra:**

```bash
crontab -l
```

---

## Chạy tay (test)

```bash
./scripts/run-build-list.sh
./scripts/run-load-campaign.sh
./scripts/run-process-replies.sh
./scripts/run-daily-report.sh
```

---

## Xem logs

```bash
tail -f logs/build-list.log
tail -f logs/load-campaign.log
tail -f logs/process-replies.log
tail -f logs/daily-report.log

# Xem tất cả
tail -f logs/*.log
```

---

## Đã tự chạy chưa? (kiểm tra trên VPS)

```bash
crontab -l | grep openclaw
```

Nếu thấy 4 dòng job → OK.

---

## Sau khi pull code trên VPS

```bash
git pull
./scripts/after-pull-vps.sh
./scripts/install-cron.sh   # nếu crontab.example thay đổi
```

---

## OpenClaw cron (disabled)

Tất cả jobs trong `cron/jobs.json` đã được set `enabled: false`.
Không cần chạy `register-cron-jobs.sh` hay `openclaw cron list` nữa.
