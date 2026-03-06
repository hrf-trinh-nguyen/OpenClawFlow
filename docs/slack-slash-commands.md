# Tạo Slash Commands trên Slack (cho OpenClaw)

Để dùng `/skill`, `/subagents`, `/agentstatus`… trong Slack, bạn cần **tạo từng slash command** trong Slack App. Slack không tự sinh lệnh từ OpenClaw.

## Bước 1: Mở Slack App

1. Vào **[api.slack.com/apps](https://api.slack.com/apps)** và đăng nhập.
2. Chọn **app** của bạn (app đang dùng với OpenClaw, có Bot Token `xoxb-...`).

## Bước 2: Vào Slash Commands

1. Trong menu bên trái, chọn **Slash Commands** (trong mục **Features**).
2. Bấm **Create New Command**.

## Bước 3: Điền thông tin cho từng command

Với **mỗi** lệnh bạn muốn dùng, tạo một command. Điền:

| Ô | Giá trị |
|---|--------|
| **Command** | Tên lệnh (không gõ dấu `/`). Ví dụ: `skill`, `subagents`, `agentstatus`. |
| **Request URL** | Với **Socket Mode** (bạn đang dùng), Slack gửi payload qua WebSocket nên URL này thường không được gọi. Điền **placeholder**: `https://socket-mode.slack.com` (hoặc bất kỳ URL HTTPS hợp lệ). Nếu sau này chuyển sang HTTP mode, đổi thành URL gateway thật (vd: `https://your-domain.com/slack/events`). |
| **Short Description** | Mô tả ngắn cho user. VD: "Run a workspace skill (e.g. apollo, build-list)". |
| **Usage Hint** | (Tùy chọn) Gợi ý tham số. VD: "apollo" hoặc "list" cho subagents. |

Sau đó bấm **Save**.

## Các command nên tạo

Tạo **ít nhất** các command sau:

| Command (trong Slack gõ) | Trong form "Command" | Short Description |
|---------------------------|----------------------|-------------------|
| `/skill` | `skill` | Run a workspace skill (e.g. apollo, build-list) |
| `/subagents` | `subagents` | List or inspect sub-agent runs (list, info, log, kill) |
| `/agentstatus` | `agentstatus` | Show bot status (Slack giữ `/status` nên dùng tên này) |
| `/help` | `help` | Show help (nếu muốn dùng native) |
| `/commands` | `commands` | List commands (nếu muốn dùng native) |

**Lưu ý:** Slack **reserve** `/status` nên không đăng ký được; OpenClaw dùng **`/agentstatus`** cho chức năng status.

## Bước 4: Cài lại app vào workspace (nếu cần)

- Nếu app đã cài vào workspace rồi, slash command mới sẽ xuất hiện sau vài giây.
- Nếu chưa cài: **Install to Workspace** (hoặc **Reinstall**) trong mục **Settings** → **Install App**.

## Kiểm tra

1. Vào Slack (DM với bot hoặc channel có bot).
2. Gõ `/` → danh sách lệnh sẽ có các command bạn vừa tạo (vd: `/skill`, `/subagents`, `/agentstatus`).
3. Thử: `/skill apollo` hoặc `/subagents list`.

## Socket Mode vs Request URL

- Bạn đang dùng **Socket Mode** (`channels.slack.mode: "socket"`). Slack **không** gửi slash command qua HTTP tới Request URL mà gửi qua kết nối WebSocket. Request URL trong form Slack chỉ để “đăng ký” command; nhiều người dùng placeholder như `https://socket-mode.slack.com`.
- Nếu sau này chuyển sang **HTTP mode**, cần đổi Request URL thành URL gateway thật (vd: `https://your-server.com/slack/events`) và cấu hình Event Subscriptions / Interactivity trỏ cùng URL đó.

## Tham khảo

- [Slack: Slash commands](https://api.slack.com/interactivity/slash-commands)
- [OpenClaw: Slash commands](https://docs.openclaw.ai/tools/slash-commands)
- [OpenClaw: Slack channel](https://docs.openclaw.ai/channels/slack)
