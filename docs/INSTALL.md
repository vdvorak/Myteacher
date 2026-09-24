# Installing Myteacher

Myteacher runs as one Docker container that serves the app and its API from one origin and keeps its data in one SQLite file (ADR 0003). This guide takes a fresh server to a working instance with a first admin and working email.

## Before you start

You need:

- a server with Docker;
- a domain name and HTTPS in front of the container (a reverse proxy such as Caddy, nginx or Traefik);
- an SMTP account the instance can send from (invitations and password resets are email only);
- a place to keep two things safe: the **instance secret** and backups of the data volume.

## 1. Create the instance secret, once

```sh
openssl rand -base64 48 > instance-secret
chmod 600 instance-secret
```

The instance secret encrypts every teacher's AI provider key and the SMTP password in the database. The app does not start without it.

> **Keep it, and keep it apart from the database.**
>
> - Generate it **once**. Never generate a new one on a restart or upgrade.
> - If it is lost or changed, the stored provider keys and the SMTP password can no longer be read. Every teacher must enter their keys again and the admin must enter the SMTP password again. Nothing else is lost: accounts, courses and results are not encrypted with it.
> - Store it in a password manager or secret store, **not** in the same backup as the database. A copied database without the secret reveals no keys; a copied database with the secret reveals all of them.
> - There is no rotation yet. Changing the secret has the consequences above.

## 2. Configure

Create an `.env` file next to `instance-secret` (readable only by you):

```sh
MYTEACHER_PUBLIC_URL=https://myteacher.example.org
MYTEACHER_ADMIN_EMAIL=admin@example.org
MYTEACHER_ADMIN_PASSWORD=choose-at-least-12-characters
```

| Variable | Default | Meaning |
|---|---|---|
| `MYTEACHER_INSTANCE_SECRET` | **required** | At least 32 random characters, see step 1. |
| `MYTEACHER_PUBLIC_URL` | the request's own address | The address people open the app at. Invitation and password reset links are built from it, so set it whenever the app is behind a proxy. |
| `MYTEACHER_ADMIN_EMAIL`, `MYTEACHER_ADMIN_PASSWORD` | unset | The first admin, created on start when the instance has no admin yet. Set both or neither. |
| `MYTEACHER_SESSION_HOURS` | `168` (7 days) | How long a sign-in lasts. |
| `MYTEACHER_SECURE_COOKIES` | `true` | Session cookies are sent over HTTPS only. Set to `false` only for plain HTTP on a host other than localhost, never in production. |
| `MYTEACHER_DATABASE_URL` | `sqlite:////data/myteacher.db` in the image | Where the database lives. |

## 3. Build and start

```sh
docker build -t myteacher .
docker run -d --name myteacher --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  -v myteacher-data:/data \
  --env-file .env \
  -e MYTEACHER_INSTANCE_SECRET="$(cat instance-secret)" \
  myteacher
```

On every start the container brings the database up to date with migrations, so the same command also upgrades an existing instance.

Point the reverse proxy at `127.0.0.1:8000` and serve it over HTTPS. For Caddy that is:

```
myteacher.example.org {
    reverse_proxy 127.0.0.1:8000
}
```

## 4. The first admin

There is no registration page. With `MYTEACHER_ADMIN_EMAIL` and `MYTEACHER_ADMIN_PASSWORD` set, the first start creates the admin. Later starts create nothing, because the instance already has one, so the variables can stay set or be removed. Removing the password from `.env` after the first start is good practice.

Alternatively, create the admin with a one-off command that asks for the password:

```sh
docker run -it --rm -v myteacher-data:/data \
  -e MYTEACHER_INSTANCE_SECRET="$(cat instance-secret)" \
  myteacher myteacher create-admin --email admin@example.org
```

Sign in at your public URL.

## 5. Email

In **Administration → Email (SMTP)** enter the server, port, security (STARTTLS on 587 or SSL/TLS on 465), username, password and sender address, then **Send test email** to yourself. The test reports the SMTP error in plain words when something is wrong. Invite teachers only once the test email arrives.

## 6. Teachers and their AI keys

In **Administration → Teachers**, invite each teacher by email. The invitation link works for 7 days and only once. The admin can resend it, which voids the previous link.

Each teacher adds their own provider key under **Settings → AI providers** and uses **Test key** to check it. The instance never shows a stored key again, only its last characters. The supported providers and their recommended models are listed in `backend/src/myteacher/assistant/providers.json`.

## Backups

Back up the `myteacher-data` volume, which holds the SQLite database. A consistent copy while the app runs:

```sh
docker exec myteacher python -c "import sqlite3; s = sqlite3.connect('/data/myteacher.db'); s.backup(sqlite3.connect('/data/backup.db'))"
docker cp myteacher:/data/backup.db ./myteacher-$(date +%F).db
```

Keep the instance secret out of these backups (see step 1). A restore needs the backup **and** the same instance secret for provider keys and the SMTP password to keep working.

## Upgrading

```sh
git pull
docker build -t myteacher .
docker rm -f myteacher
# the same docker run command as in step 3, with the same instance secret
```

Migrations run on start. Take a backup first.

## Troubleshooting

- **The container exits at start with "set MYTEACHER_INSTANCE_SECRET"**: the secret is missing or shorter than 32 characters.
- **"set both MYTEACHER_ADMIN_EMAIL and MYTEACHER_ADMIN_PASSWORD, or neither"**: only one of the two is set.
- **Invitation links point at the wrong address**: set `MYTEACHER_PUBLIC_URL`.
- **Signing in works but you are signed out right away**: the site is served over plain HTTP while secure cookies are on. Serve it over HTTPS.
- **The test email says the stored SMTP password cannot be read**, or **every teacher's key fails the test**: the instance secret changed. Restore the original secret, or have the admin and teachers enter the password and keys again.
