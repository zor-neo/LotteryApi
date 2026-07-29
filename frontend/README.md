# Developer Console

Static frontend for developers and integrators.

It behaves like a real API consumer:

- calls the deployed Worker API;
- sends `x-api-key`;
- polls at the selected interval;
- only logs meaningful changes when `revision` changes;
- renders live, confirmed, and conflict prize rows from the public result envelope.

Open `index.html` directly or deploy this folder to Cloudflare Pages.
