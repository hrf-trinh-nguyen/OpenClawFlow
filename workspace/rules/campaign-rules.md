# Campaign Rules

Rules for managing campaigns and email sending.

## Email Sequence (2-Email Philosophy)

- **Sequence:** 2 emails only (initial + follow-up)
- **Interval:** 3 days between emails
- **Sending window:** 9 AM–5 PM (lead timezone)

## Sending Limits

- Max: 30 emails per day per sending account
- Warmup: increase 10% daily for new accounts

## Pause Campaign Guardrails

Auto-pause if:
- **Bounce rate > 3%** within 24h
- **Spam complaint > 0.1%**
- **Negative reply rate > 5%**

## Copy Rotation (8 AM)

Before sending starts, review previous day's performance:
- **Pause** variant with <15% open rate after 200 sends
- **Pause** variant with 0 replies after 500 sends
- **Increase volume** on variants with >2% reply rate
- Flag underperformers for human review
