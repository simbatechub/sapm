# Put SAP2 online with Netlify

Why the first upload did not load: Netlify only showed the web page. The app also needs its
server part (the API), which Netlify runs as a "Function". This project now includes it
(`netlify.toml` + `netlify/functions/api.js`). You must deploy the WHOLE `sap2-app` folder with the
Netlify CLI. Dragging only the `public` folder onto Netlify will not work.

The online copy ALWAYS asks for an access key (API_KEY), because it is on the public internet and
holds staff bank details. On your own computer (start.bat) there is still no login.

## Steps (Windows, about 5 minutes)
1. Open a terminal in the `sap2-app` folder (VS Code: Terminal > New Terminal).
2. `npm install`
3. `npm install -g netlify-cli`
4. `netlify login`            (a browser tab opens, click Authorize)
5. `netlify link`            (choose "Enter the site name" and type your existing Netlify site name,
                              or run `netlify sites:create` to make a new one)
6. Set the two secrets (copy the DATABASE_URL value from your .env file):
   netlify env:set DATABASE_URL "postgresql://...paste here..."
   netlify env:set API_KEY "choose-a-long-password"
7. `netlify deploy --prod`
8. Open the site address it prints. You will see the login screen. Enter your API_KEY.

To update later: change files, then run `netlify deploy --prod` again.
To change the password: `netlify env:set API_KEY "new-password"` then `netlify deploy --prod`.

## If something is wrong
- "This online copy is locked": API_KEY is not set on Netlify. Do step 6, then deploy again.
- "Cannot reach the database": DATABASE_URL is missing or wrong on Netlify. Re-run step 6.
- Wrong or expired access key: type the API_KEY you set in step 6.
- Anything else: Netlify dashboard > your site > Logs > Functions shows the error.

Never upload or share your `.env` file. It contains your database password.
