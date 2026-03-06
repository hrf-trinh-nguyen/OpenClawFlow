# Reply Classification Rules

Rules for classifying outbound email replies.

## Categories

| Category | Definition | Examples |
|----------|------------|----------|
| **hot** | Ready to talk, wants call | "Let's schedule a call", "Sounds interesting, when can we talk?" |
| **soft** | Interested but bad timing | "Not right now, maybe next quarter", "Timing isn't great" |
| **objection** | Declined with reason | "We already have a solution", "Budget is tight" |
| **negative** | Unsubscribe or hard no | "Remove me", "Not interested", "Stop emailing" |

## Actions

- **hot:** Log and flag for follow-up; escalate if needed (no CRM sync)
- **soft:** Mark for follow-up in 30 days
- **objection:** Log reason, nurture after 90 days
- **negative:** Add to blacklist, stop sending

## Escalation Triggers

- **Deliverability drops below 90%** on any account: pause and alert
- **>5% negative replies** on any variant: pause campaign and report
- **Any reply mentioning legal/spam:** pause and flag for human review
