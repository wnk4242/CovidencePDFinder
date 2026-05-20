# Covidence PDF Finder

Covidence PDF Finder is designed to help researchers find PDF files for studies during the full-text review stage in Covidence. This tool is especially useful for systematic reviews, scoping reviews, meta-analyses, and other evidence synthesis projects where reviewers need to locate and upload full-text PDFs for many papers.

It is available as both a Chrome Extension and a Tampermonkey userscript.

## Main Features

- Automatically searches direct open-access PDF sources first, including:
  - Unpaywall
  - Europe PMC / PubMed Central
  - DOI landing pages
- If no open-access PDF is found, allows users to manually search additional sources, including Google Search, Google Scholar, OpenAlex, and ResearchGate.
- Includes a custom database search option that helps researchers search for PDFs using institutional library resources, such as EBSCO.
- Helps fill search boxes automatically on supported database pages.

<p align="center">
  <img src="pics/1.png" style="margin-left: 20px;" />
</p>

---

# Chrome Extension Installation

1. Click the green `<> Code` button on this GitHub page.
2. Click `Download ZIP`.
3. Unzip the downloaded ZIP file.
4. Only keep the `CovidencePDFinder` folder.
5. Open the `content.js` file.
6. Replace `YOUR_EMAIL@example.com` with your real email address. This is needed because Unpaywall asks API users to include a real email address.
7. Open Google Chrome.
8. Go to `chrome://extensions/`.
9. Turn on `Developer mode` in the top-right corner.
10. Click `Load unpacked`.
11. Select the `CovidencePDFinder` folder.
12. The extension should now be installed and ready to use.

## How to Use the Chrome Extension

1. Open a Covidence full-text review page.
2. Go to a study that needs a full-text PDF.
3. Use the added **Find + Download PDF** button to search for an open-access PDF.
4. Use **Search Options** if you want to manually search Google Scholar, ResearchGate, OpenAlex, DOI pages, or a custom database.
5. If using **Custom Search**, enter the database website and choose whether to search by DOI or title.

---

# Tampermonkey Userscript Installation

The userscript version requires the Tampermonkey browser extension.

## Step 1: Install Tampermonkey

1. Open Google Chrome.
2. Go to the Chrome Web Store.
3. Search for `Tampermonkey`.
4. Install the Tampermonkey extension.

## Step 2: Create a New Userscript

1. Click the Tampermonkey icon in your browser.
2. Click `Dashboard`.
3. Click the `+` button or `Create a new script`.
4. Delete the default code in the editor.

## Step 3: Add the Covidence PDF Finder Script

1. Copy the full Covidence PDF Finder userscript code.
2. Paste it into the Tampermonkey editor.
3. Find this line in the script: `const UNPAYWALL_EMAIL = "YOUR_EMAIL@example.com";`
4. Replace `YOUR_EMAIL@example.com` with your real email address.

## Step 4: Save the Script

1. Click `File`.
2. Click `Save`.
3. Make sure the script is enabled in the Tampermonkey Dashboard.

## Step 5: Use the Userscript in Covidence

1. Open a Covidence full-text review page.
2. The script should automatically add PDF search tools to each visible study card.
3. Click **Find + Download PDF** to search for a direct open-access PDF.
4. Click **Search Options** to use other manual search tools.
5. Use **Custom Search** if you want to search a specific database by DOI or title.

---

# Chrome Extension vs. Userscript

Use the Chrome Extension if you want a simple installation folder that can be loaded into Chrome.

Use the Tampermonkey userscript if you want to easily edit the code, customize search options, or test new features.
