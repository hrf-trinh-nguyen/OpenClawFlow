# ICP & Apollo Filter Configuration

Default ICP: **United States + Canada**; **10–50 employees**; industries: **Computer Software**, **Marketing & Advertising**, **Retail**.

---

## Locations

- **Person & company HQ:** `["United States", "Canada"]` (fixed, no override in code)
- Override via `PERSON_LOCATIONS` env if needed (not wired by default)

---

## Company size

Default: **10–50 employees** → Apollo ranges `["11,20","21,50"]`.

Override: `ORGANIZATION_NUM_EMPLOYEES_RANGES='["11,20","21,50","51,100"]'`

---

## Industries

Default: **Computer Software**, **Marketing & Advertising**, **Retail**.

Override: `ORGANIZATION_INDUSTRY_TAG_IDS='["id1","id2"]'` (Apollo tag IDs if different format needed)

---

## Job titles (default)

vp marketing, head of marketing, vp sales, director of marketing, director of sales

Override: `PERSON_TITLES='["ceo","founder"]'`

---

## Example

```bash
cd ~/.openclaw && source .env && TARGET_COUNT=100 node workspace/skills/apollo/index.mjs
```
