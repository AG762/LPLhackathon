# "Your files are scanned" emails (D.9)

When a sensitive-data scan finishes, ShredSafe emails each person whose files were in it:

> **Your files are scanned and ready for review (14 files)**
> ShredSafe finished checking 14 of your files for sensitive client data.
> - 6 files are past retention and ready to delete
> - 2 files hold a lot of client data (SSNs, account numbers), so they're at the top of your queue
> - 1 file needs a person to decide
> - 2 files are under a legal hold and will be kept
>
> Nothing has been deleted. Every deletion waits for your approval.  **[Open your review queue]**

## How it works

- `NotifyFunction` (same code as the API, handler `notify.main`) runs every 5 minutes.
- When the newest Macie scan is `COMPLETE` and hasn't been announced, it scores the scan's files if nobody
  has opened the results yet (the same code as **Show sensitive-data results**), then sends each uploader one
  summary of **their own** files through **Amazon SES**.
- It writes a `SCAN_NOTIFIED` audit entry, so each scan is announced once, and the audit log records that
  people were told.
- **Recipients:** the uploader (`ownerAdvisorId`, which is their email once sign-in is on). Files uploaded without
  sign-in (the demo) go to `NotifyFallbackTo`, or to nobody if that's empty.
- **Off by default.** With `NotifyFrom` empty, the function isn't created at all.
- **Free:** SES costs $0.10 per 1,000 emails (the free tier covers 3,000 a month in the first year), and the
  schedule's Lambda runs fall well inside the free tier.

## Turning it on (Arihant, about 10 minutes)

1. **Verify the sender:** SES console (`us-east-1`), then **Identities**, then **Create identity**, then **Email address**, e.g.
   your own email. Click the link SES emails you.
2. **Verify each recipient** the same way. The account starts in the SES *sandbox*, which only delivers to
   verified addresses, so verify the team's emails (and whoever presents). Production access would lift this
   (an SES console request, about a day).
3. **Set the parameters** in `infra/samconfig.toml` `parameter_overrides` (edit the file; a CLI override
   replaces the whole line):
   `NotifyFrom=you@example.com NotifyFallbackTo=you@example.com`
4. `sam build && sam deploy`.

## Testing it live

1. Upload a few files from the Upload page. The sensitive-data scan starts by itself (F.19).
2. Wait for the scan (the Upload page and queue show the expected finish time), then up to 5 more minutes.
3. Check the inbox (and spam). The function's log shows who was emailed:
   `sam logs -n NotifyFunction --stack-name shredsafe --tail`
4. To force it right away: `aws lambda invoke --function-name <NotifyFunction name> /dev/stdout`.
   A repeat run answers `already notified`.

Tests: `backend/tests/test_notify.py` (fake Macie, moto SES).
