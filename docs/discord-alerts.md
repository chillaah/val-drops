# Discord alerts for your server

[← Back to the README](../README.md)

Want new rewards posted in your own server? You don't need to copy this project. A small workflow in a GitHub repo of yours reads the site's [public data](data.md) every 3 hours and posts anything new to your channel. It's free.

1. **Make a webhook.** In Discord, open **Server Settings → Integrations → Webhooks → New Webhook**, pick the channel and click **Copy Webhook URL**.
2. **Make a repo.** On GitHub, create a new **private** repository. Any name works, for example `val-drops-alerts`.
3. **Add the webhook as a secret.** In that repo, open **Settings → Secrets and variables → Actions → New repository secret**. Name it `DISCORD_WEBHOOK_URL` and paste the URL.
4. **Add the workflow.** Create the file `.github/workflows/val-drops.yml` with the contents of [`examples/discord-alerts.yml`](../examples/discord-alerts.yml).
5. **Run it once.** Open the **Actions** tab, pick **VAL Drops alerts** and click **Run workflow**. A "VAL Drops alerts are set up" message appears in your channel. From then on, new rewards are posted as they're found.

Good to know:
- **Use a private repo.** GitHub turns off scheduled workflows in public repos with no activity for 60 days. Each run takes well under a minute, far inside the free Actions allowance.
- **What gets posted:** the same items as this project's own alerts. That means new rewards you can claim now or soon, and rewards whose claim window just opened. Items you can't claim (ended, China only, unconfirmed dates) are left out.
- **Flood guard:** more than 10 new items at once are posted as one summary. If the list suddenly shrinks, nothing is posted.
- **To stop alerts,** delete the webhook in Discord or disable the workflow.

## For the maintainer: pausing alerts in other servers

Followers post whatever the live `data/items.json` contains. If production publishes wrong items, set `"paused": true` in [`data/alerts.json`](../data/alerts.json) and deploy. Followers then post nothing, and they don't mark anything as seen. Fix the data, set it back to `false`, and the next run compares against the list from before the pause, so only the correct changes go out. The pause doesn't affect this repo's own Discord alerts. Messages that were already posted can't be removed from other servers.
