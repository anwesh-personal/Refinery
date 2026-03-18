# Verify550 API Reference

**Base URL:** `https://app.verify550.com/api`  
**Auth:** Query param `secret={{API_SECRET}}` on every request  
**API Key Storage:** Per-user, saved in Supabase `profiles` or `system_config`

---

## 1. Get Credits

```
GET /getCredit?secret={{API_SECRET}}
```

**Response:** Plain number (e.g. `2091584`)

---

## 2. Verify Single Email

```
GET /verifyemail?secret={{API_SECRET}}&email={{EMAIL_ADDRESS}}
```

**Response:** Plain string status. Possible values:

| Status | Category |
|--------|----------|
| `ok` | ✅ Safe to send |
| `ok_for_all` | ✅ Catch-all (accepts everything) |
| `email_disabled` | ❌ Disabled/inactive |
| `dead_server` | ❌ Server down |
| `invalid_mx` | ❌ No MX records |
| `invalid_syntax` | ❌ Bad format |
| `smtp_protocol` | ❌ SMTP error |
| `unknown` | ⚠️ Could not determine |
| `antispam_system` | ⚠️ Blocked by antispam |
| `soft_bounce` | ⚠️ Temporary failure |
| `hard_bounces` | ❌ Permanent bounce |
| `complainers` | 🚫 Known complainer |
| `sleeper_cell` | 🚫 Inactive trap |
| `seeds` | 🚫 Seed address |
| `invalid_vendor_response` | ⚠️ Vendor error |
| `email_bot` | 🚫 Bot address |
| `spamcops` | 🚫 SpamCop listed |
| `spamtraps` | 🚫 Spam trap |
| `threat_endings` | 🚫 Threat ending domain |
| `threat_string` | 🚫 Threat string match |
| `advisory_trap` | 🚫 Advisory trap |
| `blacklisted` | 🚫 Blacklisted |
| `disposables` | 🚫 Disposable email |
| `bot_clickers` | 🚫 Bot clicker |
| `litigators` | 🚫 Known litigator |
| `departmental` | ⚠️ Role/department address |
| `lashback` | 🚫 Lashback listed |

---

## 3. Upload Bulk CSV

```
POST /bulk?secret={{API_SECRET}}&filename=example.csv
Content-Type: multipart/form-data
Body: file_contents=@/path/to/example.csv;type=text/csv
```

**Response:**
```json
{
    "success": true,
    "message": "",
    "id": "12702",
    "job_id": "1706543459",
    "filename": "example.csv"
}
```

---

## 4. Get Job Details

```
GET /getjob/{{JOB_ID}}?secret={{API_SECRET}}
```

**Response:**
```json
{
    "success": true,
    "message": null,
    "data": {
        "jobId": "1706543459",
        "status": "finished",
        "file_name": "example.csv",
        "count": 1221,
        "duplicates": 0,
        "processed": 1221,
        "uploadTime": "2024-01-29T13:09:35.008Z",
        "startTime": "2024-01-29T13:09:36.619Z",
        "completionTime": "2024-01-29T13:10:26.247Z",
        "suppression_results": {
            "ok": 750,
            "email_disabled": 118,
            "disposables": 1,
            "unknown": 1,
            "ok_for_all": 116,
            "antispam_system": 8,
            "spamtraps": 0,
            "spamcops": 1,
            "litigators": 0,
            "complainers": 10,
            "hard_bounces": 17,
            "soft_bounce": 0,
            "dead_server": 0,
            "invalid_mx": 53,
            "invalid_syntax": 2,
            "smtp_protocol": 4,
            "sleeper_cell": 0,
            "seeds": 0,
            "email_bot": 25,
            "bot_clickers": 0,
            "blacklisted": 62,
            "departmental": 43,
            "lashback": 0,
            "thread_endings": 0,
            "thread_string": 0,
            "advisory_trap": 0,
            "invalid_vendor_response": 3
        }
    }
}
```

**Statuses:** `progress`, `finished`

---

## 5. Get All Completed Jobs

```
GET /completedjobs?secret={{API_SECRET}}
```

**Response:** Array of job objects with `aggregate` stats (same keys as `suppression_results`).

---

## 6. Get All Running Jobs

```
GET /runningjobs?secret={{API_SECRET}}
```

**Response:** Same structure as completed jobs but with `status: "progress"`.

---

## 7. Download/Export Results

**All results:**
```
GET /jobexport/{{JOB_ID}}?secret={{API_SECRET}}
```

**By format:**
```
GET /jobexport/{{JOB_ID}}?format=xlsx&secret={{API_SECRET}}
```

**By category filter:**
```
GET /jobexport/{{JOB_ID}}?categories=ok,email_disabled,unknown&secret={{API_SECRET}}
```

**Response:** Binary `.zip` file containing result files in the requested format and categories.

**Accepted formats:** `xlsx`, `csv`

**Accepted categories:**
`ok`, `ok_for_all`, `dead_server`, `invalid_mx`, `email_disabled`, `invalid_syntax`,
`smtp_protocol`, `unknown`, `antispam_system`, `soft_bounce`, `complainers`,
`sleeper_cell`, `seeds`, `invalid_vendor_response`, `hard_bounces`, `email_bot`,
`spamcops`, `spamtraps`, `threat_endings`, `threat_string`, `advisory_trap`,
`blacklisted`, `disposables`, `bot_clickers`, `litigators`, `departmental`

---

## Category Groups (for UI)

### ✅ Safe (sendable)
- `ok`
- `ok_for_all`

### ⚠️ Risky (use with caution)
- `unknown`
- `antispam_system`
- `soft_bounce`
- `departmental`
- `invalid_vendor_response`

### ❌ Dead (do not send)
- `email_disabled`
- `dead_server`
- `invalid_mx`
- `invalid_syntax`
- `smtp_protocol`
- `hard_bounces`

### 🚫 Threats (blacklist immediately)
- `complainers`
- `sleeper_cell`
- `seeds`
- `email_bot`
- `spamcops`
- `spamtraps`
- `threat_endings`
- `threat_string`
- `advisory_trap`
- `blacklisted`
- `disposables`
- `bot_clickers`
- `litigators`
- `lashback`
