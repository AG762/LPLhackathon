# How to run ShredSafe

This guide walks you through getting ShredSafe running, from a fresh start to a working website you can sign in to.
You'll do everything in the **online VS Code** the hackathon gave us. It already has access to our AWS account,
so there's nothing to install on your own laptop.

> **Already set up and just want the latest version?** Open a terminal in your folder and run:
>
> ```bash
> git pull
> cd infra && sam build && sam deploy
> cd ../frontend && npm install && npm run online
> ```
>
> Type `y` when it asks to deploy, then open the website (step 5).

---

## Step 1: Get your own copy of the code

Each person works in their own folder, so we don't change each other's files by accident.

1. In the online VS Code, open a terminal: **Terminal → New Terminal**.
2. Copy the code into a folder with your name:

   ```bash
   cd /workshop
   git clone https://github.com/AG762/LPLhackathon.git LPLhackathon-yourname
   ```

3. Open that folder: **File → Open Folder**, then pick `/workshop/LPLhackathon-yourname`.

You only do this once.

## Step 2: Check everything is ready

Paste this into the terminal:

```bash
aws sts get-caller-identity
sam --version || pip install --user aws-sam-cli
```

The first line should print some account details. If it shows an error instead, the workshop login has
expired. Refresh the hackathon page and open the online VS Code again.

## Step 3: Put the app on AWS

This creates (or updates) everything ShredSafe needs on AWS: file storage, the database, the AI classifier and
sign-in.

```bash
cd /workshop/LPLhackathon-yourname/infra
sam build && sam deploy
```

After a minute it lists what it's about to change and asks **"Deploy this changeset?"**. Type `y` and press
Enter. It takes a few minutes and ends with a list of outputs.

> **Stop and ask the team** if any line in that list says **Delete** next to something called a bucket or a
> table. That would delete our files.

The settings for this step live in `infra/samconfig.toml`. You normally don't need to change them.

## Step 4: Add the starting data and the first admin

Only needed the first time (or after starting over).

```bash
cd /workshop/LPLhackathon-yourname
python3 scripts/seed.py
python3 scripts/create_user.py your.email@example.com --role admin
```

- The first command loads the retention rules and the sample legal holds.
- The second creates the **first admin account**. Use a real email address: AWS emails it a temporary
  password. Everyone else gets invited from inside the app later (step 6).

## Step 5: Start the website

```bash
cd /workshop/LPLhackathon-yourname
python3 scripts/frontend_env.py > frontend/.env.local
cd frontend
npm install
npm run online
```

When it says it's ready, open this address in your browser (keep the `/` at the end):

**https://d18wlstpxd4zq5.cloudfront.net/ports/5173/**

Leave that terminal open; closing it stops the website. To stop it on purpose, click in the terminal and press
**Ctrl+C**.

**Someone else is already using 5173?** Use a different number, like 5174:

```bash
npx vite build --base ./ && npx vite preview --host --port 5174 --strictPort
```

and open `https://d18wlstpxd4zq5.cloudfront.net/ports/5174/` instead.

## Step 6: Sign in and invite your team

1. On the website, click **Sign in**. Use the admin email from step 4 and the temporary password from the email
   (from `no-reply@verificationemail.com`; check spam).
2. You'll be asked to choose your own password. After that you're in.
3. To add teammates: go to **Admin → People → Invite**, enter their email and choose a role. They get an email
   with a temporary password and a link, and choose their own password the first time they sign in.

Everyone you invite joins **your workspace** and sees the same files. People in other workspaces never see them.

**Sample vs Live:** the switch at the bottom of the sidebar. **Sample** shows made-up files and needs no
sign-in, which is handy for practicing the demo. **Live** shows the real files on AWS.

---

## Doing a fresh demo run

To clear out all uploaded files and the audit log and start over (sign-in accounts are kept):

```bash
cd /workshop/LPLhackathon-yourname
python3 scripts/reset_demo.py --yes
```

Then upload the sample files from the `data/samples` folder on the **Upload** page.

## If something goes wrong

**The page is blank or black.** Make sure the address ends with a `/` (`…/ports/5173/`), then press
**Ctrl+Shift+R** to reload.

**"Port already in use" when starting the website.** Someone is already on that port. Use another number
(step 5). If it's an old copy of yours, find the terminal it's running in and press **Ctrl+C**.

**"There is already a signed in user."** Your browser still remembers an earlier sign-in. Sign out from the
sidebar, or open the site in a private/incognito window.

**"That email and password don't match an account."** Double-check the password. The account also has to
exist on this setup. Ask whoever runs AWS to check.

**The invitation or password email never arrives.** Check spam first. If several have gone missing, AWS's
built-in email sender may have hit its daily limit (about 50 a day). Ask whoever runs AWS to set a password for
you instead: `python3 scripts/create_user.py your.email@example.com --password 'A-long-password-1'`.

**The deploy in step 3 fails.** Copy the first line that says `FAILED` and send it to the team.

**Uploaded files never show up in the queue.** Send the team the output of:

```bash
sam logs -n ProcessFunction --stack-name shredsafe --since 15m
```

---

**Want more detail?** How sign-in and workspaces work: [docs/login.md](docs/login.md). The "your files are
scanned" emails: [docs/notifications.md](docs/notifications.md). The demo script:
[docs/demo-script.md](docs/demo-script.md).
