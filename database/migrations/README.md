# Database migrations (PART 2 + PART 3)

PostgreSQL के लिए Part 2/3 की माइग्रेशन। Part 1 का स्केमा (`database/schema.sql`) पहले लगना चाहिए।

## Difficulty की कोई बात नहीं — चलाने के तरीक़े

```bash
# 1) सर्वर/PC पर (अनुशंसित)
psql "$DATABASE_URL" -f database/001_schema.sql        # (Part 1: schema.sql को पहले apply करें)
psql "$DATABASE_URL" -f database/migrations/002_part2_users_shops.sql
psql "$DATABASE_URL" -f database/migrations/003_part3_catalogue.sql
psql "$DATABASE_URL" -f database/migrations/004_part3_inventory.sql

# 2) Docker one-liner
docker run --rm -it -e PGPASSWORD=... postgres:16 \
  psql -h dbhost -U pos -d posdb -f /migrations/002_part2_users_shops.sql
```

`psql` पर जो भी पास (`On conflict do nothing`, `IF NOT EXISTS`) माइग्रेशन को दोबारा चलाया जा सकता है।

> ⚠️ **003 सिर्फ़ PostgreSQL 13+ के लिए है** (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
> Production में MySQL इस्तेमाल हो तो यह file translate करनी पड़ेगी — engine पक्का करें.

## पूछो जाने वाले सवाल

- **Design decision**: `users` + `shop_members` — ownership access कंट्रोल बैकएंड करता है (client सिर्फ़ अपनी दुकान PATCH कर सकता है)।
- **OTP** हमेशा हैश में (`code_hash`), TTL ~5 मिनट, `attempts` की सीमा — प्लेन्टेक्स्ट/लॉग नहीं।
- **खुद को अप्रूव नहीं कर सकते**: क्लाइंट API में `approval_status`/`published` बदलने की अनुमति नहीं (केवल `POST /shops/:id/submit-for-approval`)।
- Services restart से नहीं — `shops` के नए कॉलम क्लाइंट से पारदर्शी, पुराने screens (Part-1) चलते रहेंगे।
- Rollback पढ़ें SQL तल-टिप्पणी (dev-only)।
