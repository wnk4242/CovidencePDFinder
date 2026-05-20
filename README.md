# Covidence PDF Finder

Covidence PDF Finder is available as both a Chrome Extension and a Tampermonkey userscript. The two versions are designed to do the same thing: help users find PDF files for studies during the full-text review stage in Covidence.

This tool is especially useful for systematic reviews, scoping reviews, meta-analyses, and other evidence synthesis projects where reviewers need to locate and upload full-text PDFs for many papers.
<p align="center">
  <img src="pics/1.png" style="margin-left: 20px;" />
</p>
## Purpose

Finding full-text PDFs can be repetitive and time-consuming, especially when working through many studies in Covidence. Covidence PDF Finder adds search tools directly to Covidence study cards, allowing users to quickly search for PDFs and related article pages without manually copying and pasting titles or DOIs into different websites.

The tool is designed to make full-text retrieval faster, more organized, and easier for users who may not be familiar with advanced database searching.

## Main Features

- Adds a **Find + Download PDF** button to Covidence full-text review pages.
- Searches direct open-access PDF sources automatically, including:
  - Unpaywall
  - Europe PMC / PubMed Central
  - DOI landing pages
- Opens Google Scholar as a fallback when no direct open-access PDF is found.
- Provides a **Search Options** menu for manually searching additional sources.
- Supports searching by article title or DOI, depending on the source.
- Includes a custom database search option where users can enter a database homepage and choose whether to search by DOI or title.
- Remembers the custom database website previously entered by the user.
- Remembers whether the user prefers DOI or title for custom searches.
- Helps fill search boxes automatically on supported database pages.
- Adds a small Google Scholar helper panel to detect possible PDF links from Google Scholar results.
- Validates downloaded files to reduce the chance of saving an HTML page instead of a real PDF.

## What It Is Good At

Covidence PDF Finder is good at speeding up the full-text retrieval workflow. It reduces the need to repeatedly copy and paste article titles, DOIs, and search terms across different websites.

It is especially helpful when:

- You are screening many full-text studies in Covidence.
- You need to quickly check whether a PDF is openly available.
- You want one-click access to Google Scholar, ResearchGate, DOI pages, OpenAlex, or other search tools.
- You want to use a specific database search page without manually copying the title or DOI.
- You are helping students, collaborators, or reviewers who may not be comfortable with complex database search workflows.

## Limitations

This tool does not guarantee that every PDF can be found. Some articles are behind paywalls, require institutional login, or do not have an openly available PDF.

The **Find + Download PDF** button only checks direct open-access sources first. If no PDF is found, it opens Google Scholar as a fallback. Other sources in the **Search Options** menu are manual search options and are only used when clicked.

Some subscription databases may change their website structure, which can affect whether the tool can automatically paste search terms into the search box.

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

The Chrome Extension and Tampermonkey userscript are functionally very similar. Both are intended to support the same full-text retrieval workflow in Covidence.

The Chrome Extension may be easier for users who do not want to manage userscripts. The Tampermonkey version may be easier for users who prefer to edit or customize the script directly.

## Recommended Use

Use the Chrome Extension if you want a simple installation folder that can be loaded into Chrome.

Use the Tampermonkey userscript if you want to easily edit the code, customize search options, or test new features.

---

# Notes

Unpaywall asks API users to include a real email address. This email is used for responsible API use and should be replaced before using the tool.

This project is intended to support legitimate full-text retrieval workflows. Users are responsible for following copyright rules, database terms of use, and institutional access policies.
