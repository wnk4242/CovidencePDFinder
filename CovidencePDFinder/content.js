// Chrome extension content script converted from the Tampermonkey userscript.
(function () {
    'use strict';

    /************************************************************
     * IMPORTANT:
     * Unpaywall asks API users to include a real email address.
     * Replace this with your email.
     ************************************************************/
    const UNPAYWALL_EMAIL = "YOUR_EMAIL@example.com";

    const SCRIPT_TAG = "covi-pdf-finder";

    /************************************************************
     * This extension runs on:
     * 1. Covidence pages
     * 2. Google Scholar pages
     * 3. Custom database pages opened from the Custom Search dialog.
     *
     * Some database sites, including JSTOR, may remove or ignore URL
     * fragments such as #coviCustomSearch= after loading. For that reason,
     * the extension also stores one pending custom search in chrome.storage
     * and lets the target page recover it even if the hash disappears.
     ************************************************************/
    const IS_COVIDENCE = location.hostname.includes("app.covidence.org");
    const IS_SCHOLAR = location.hostname.includes("scholar.google.com");
    const IS_CUSTOM_DATABASE_TARGET = window.location.hash.includes("coviCustomSearch=");
    const PENDING_CUSTOM_SEARCH_KEY = "covi_pdf_finder_pending_custom_search";

    function normalizeHostForMatch(hostname) {
        return String(hostname || "").toLowerCase().replace(/^www\./, "");
    }

    function chromeStorageGet(key) {
        return new Promise(resolve => {
            try {
                if (!chrome || !chrome.storage || !chrome.storage.local) {
                    resolve({});
                    return;
                }
                chrome.storage.local.get(key, result => resolve(result || {}));
            } catch (e) {
                resolve({});
            }
        });
    }

    function chromeStorageSet(obj) {
        return new Promise(resolve => {
            try {
                if (!chrome || !chrome.storage || !chrome.storage.local) {
                    resolve();
                    return;
                }
                chrome.storage.local.set(obj, resolve);
            } catch (e) {
                resolve();
            }
        });
    }

    function chromeStorageRemove(key) {
        return new Promise(resolve => {
            try {
                if (!chrome || !chrome.storage || !chrome.storage.local) {
                    resolve();
                    return;
                }
                chrome.storage.local.remove(key, resolve);
            } catch (e) {
                resolve();
            }
        });
    }

/************************************************************
     * Shared utilities
     ************************************************************/

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function sanitizeFilenamePart(text) {
        if (!text) return "";

        return String(text)
            .replace(/[\\/:*?"<>|]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80);
    }

    function cleanTitleForSearch(title) {
        if (!title) return "";

        return String(title)
            .replace(/^\s*\[/, "")
            .replace(/\]\s*\.?\s*$/, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function normalizeDOI(raw) {
        if (!raw) return "";

        let doi = String(raw).trim();

        doi = doi.replace(/^doi:\s*/i, "");
        doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
        doi = doi.replace(/[.,;)\]]+$/g, "");

        const match = doi.match(/10\.\d{4,9}\/[^\s"'<>]+/i);

        return match ? match[0].replace(/[.,;)\]]+$/g, "") : "";
    }

    function extractYear(text) {
        if (!text) return "";

        const matches = String(text).match(/\b(19|20)\d{2}\b/g);

        if (!matches || !matches.length) return "";

        return matches[matches.length - 1];
    }

    function extractStudyNumber(text) {
        const match = String(text || "").match(/#\s*(\d+)/);
        return match ? match[1] : "";
    }

    function extractFirstAuthor(text) {
        if (!text) return "";

        const cleanText = String(text);

        const studyLineMatch = cleanText.match(/#\s*\d+\s*-\s*([A-Za-zÀ-ÿ'’`-]+)/);

        if (studyLineMatch) {
            return studyLineMatch[1];
        }

        const possibleAuthorLine = cleanText
            .split("\n")
            .map(x => x.trim())
            .find(line => {
                return (
                    line.includes(";") &&
                    !line.toLowerCase().includes("doi") &&
                    !line.toLowerCase().includes("abstract") &&
                    !line.toLowerCase().includes("upload") &&
                    !line.toLowerCase().includes("include") &&
                    !line.toLowerCase().includes("exclude")
                );
            });

        if (possibleAuthorLine) {
            const firstChunk = possibleAuthorLine.split(";")[0].trim();
            const surname = firstChunk.split(/[,\s]+/)[0];
            return surname || "";
        }

        return "";
    }

    function extensionRequest(message) {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(message, response => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    if (!response || !response.ok) {
                        reject(new Error((response && response.error) || "Extension request failed."));
                        return;
                    }

                    resolve(response);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async function requestJSON(url) {
        const response = await extensionRequest({
            action: "fetchJson",
            url
        });

        return response.data;
    }

    function requestText(url) {
        return extensionRequest({
            action: "fetchText",
            url
        }).then(response => ({
            finalUrl: response.finalUrl || url,
            text: response.text || "",
            status: response.status || 0
        }));
    }

    function getResponseHeader(responseHeaders, headerName) {
        const regex = new RegExp("^" + headerName + "\\s*:\\s*(.+)$", "im");
        const match = String(responseHeaders || "").match(regex);
        return match ? match[1].trim() : "";
    }

    function isProbablyPDFUrl(url) {
        if (!url) return false;

        return (
            /\.pdf(\?|#|$)/i.test(url) ||
            /\/pdf(\/|\?|#|$)/i.test(url) ||
            /format=pdf/i.test(url) ||
            /type=pdf/i.test(url)
        );
    }

    function absolutizeUrl(url, baseUrl) {
        try {
            return new URL(url, baseUrl).href;
        } catch (e) {
            return "";
        }
    }

    function makeButton(label, className, onClick) {
        const btn = document.createElement("button");

        btn.textContent = label;
        btn.type = "button";
        btn.className = `${SCRIPT_TAG}-btn ${className || ""}`;

        btn.addEventListener("click", onClick);

        return btn;
    }

    function setStatus(statusEl, message, type) {
        if (!statusEl) return;

        statusEl.textContent = message;
        statusEl.classList.remove("good", "bad", "warn");

        if (type) {
            statusEl.classList.add(type);
        }
    }

    function makeDraggable(panel, handle) {
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        handle.addEventListener("mousedown", e => {
            dragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            document.body.style.userSelect = "none";
        });

        document.addEventListener("mousemove", e => {
            if (!dragging) return;
            panel.style.left = `${e.clientX - offsetX}px`;
            panel.style.top = `${e.clientY - offsetY}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
        });

        document.addEventListener("mouseup", () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.userSelect = "";
        });
    }

    function saveArrayBufferAsPDF(buffer, filename) {
        const blob = new Blob([buffer], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    }

    function getHeaderTextFromBuffer(buffer) {
        if (!buffer || buffer.byteLength < 4) return "";

        const firstBytes = new Uint8Array(buffer.slice(0, 16));

        return Array.from(firstBytes)
            .map(byte => String.fromCharCode(byte))
            .join("");
    }

    function looksLikeRealPDF(buffer, responseHeaders) {
        if (!buffer || buffer.byteLength < 1000) {
            return {
                ok: false,
                reason: "Downloaded file is too small."
            };
        }

        const headerText = getHeaderTextFromBuffer(buffer);
        const contentType = getResponseHeader(responseHeaders, "content-type").toLowerCase();

        if (headerText.startsWith("%PDF")) {
            return {
                ok: true,
                reason: "PDF signature detected."
            };
        }

        if (contentType.includes("application/pdf") && buffer.byteLength > 10000) {
            return {
                ok: true,
                reason: "PDF content type detected."
            };
        }

        if (/^\s*<!doctype html/i.test(headerText) || /^\s*<html/i.test(headerText)) {
            return {
                ok: false,
                reason: "The link returned an HTML page, not a PDF."
            };
        }

        return {
            ok: false,
            reason: "The downloaded file does not look like a real PDF."
        };
    }


    /************************************************************
     * Custom database search
     ************************************************************/

    function getCustomSearchText(meta, searchType) {
        const cleanTitle = cleanTitleForSearch(meta.title);
        const doi = meta.doi || "";

        if (searchType === "doi") return doi;
        if (searchType === "title") return cleanTitle;
        return doi || cleanTitle || "";
    }

    function normalizeDatabaseHomepage(input) {
        if (!input) return "";
        let value = String(input).trim();
        if (!/^https?:\/\//i.test(value)) value = "https://" + value;

        try {
            return new URL(value).href;
        } catch (e) {
            return "";
        }
    }

    function showCustomSearchDialog(meta, savedHomepage, savedSearchType) {
        return new Promise(resolve => {
            const cleanTitle = cleanTitleForSearch(meta.title);
            const doi = meta.doi || "";

            if (!doi && !cleanTitle) {
                resolve(null);
                return;
            }

            const oldDialog = document.getElementById(`${SCRIPT_TAG}-custom-dialog-overlay`);
            if (oldDialog) oldDialog.remove();

            const overlay = document.createElement("div");
            overlay.id = `${SCRIPT_TAG}-custom-dialog-overlay`;
            overlay.style.cssText = `
                position: fixed;
                inset: 0;
                z-index: 9999999;
                background: rgba(15, 23, 42, 0.35);
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: Arial, sans-serif;
            `;

            const dialog = document.createElement("div");
            dialog.style.cssText = `
                width: 470px;
                max-width: calc(100vw - 32px);
                background: #ffffff;
                border-radius: 12px;
                box-shadow: 0 12px 35px rgba(15, 23, 42, 0.28);
                border: 1px solid #cbd5e1;
                padding: 16px;
                color: #0f172a;
            `;

            const title = document.createElement("div");
            title.textContent = "Custom Database Search";
            title.style.cssText = "font-size:16px;font-weight:700;margin-bottom:10px;";

            const websiteLabel = document.createElement("label");
            websiteLabel.textContent = "Database website address";
            websiteLabel.style.cssText = "display:block;font-size:13px;font-weight:600;margin-bottom:5px;";

            const websiteInput = document.createElement("input");
            websiteInput.type = "text";
            websiteInput.value = savedHomepage || "";
            websiteInput.placeholder = "Example: https://psycnet.apa.org/home or www.jstor.org";
            websiteInput.style.cssText = `
                width: 100%;
                box-sizing: border-box;
                border: 1px solid #cbd5e1;
                border-radius: 6px;
                padding: 8px 9px;
                font-size: 13px;
                margin-bottom: 12px;
            `;

            const choiceLabel = document.createElement("div");
            choiceLabel.textContent = "Search by";
            choiceLabel.style.cssText = "font-size:13px;font-weight:600;margin-bottom:6px;";

            const choices = document.createElement("div");
            choices.style.cssText = "display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;";

            function makeRadioLabel(labelText, value, enabled, checked) {
                const label = document.createElement("label");
                label.style.cssText = `display:flex;align-items:center;gap:5px;font-size:13px;cursor:${enabled ? "pointer" : "not-allowed"};opacity:${enabled ? "1" : "0.45"};`;
                const radio = document.createElement("input");
                radio.type = "radio";
                radio.name = `${SCRIPT_TAG}-custom-search-type`;
                radio.value = value;
                radio.disabled = !enabled;
                radio.checked = checked;
                label.appendChild(radio);
                label.appendChild(document.createTextNode(labelText));
                return { label, radio };
            }

            const canUseDOI = !!doi;
            const canUseTitle = !!cleanTitle;
            const rememberedType = savedSearchType === "title" || savedSearchType === "doi"
                ? savedSearchType
                : "";

            let initialSearchType = "";
            if (rememberedType === "doi" && canUseDOI) {
                initialSearchType = "doi";
            } else if (rememberedType === "title" && canUseTitle) {
                initialSearchType = "title";
            } else if (canUseDOI) {
                initialSearchType = "doi";
            } else if (canUseTitle) {
                initialSearchType = "title";
            }

            const doiChoice = makeRadioLabel("DOI", "doi", canUseDOI, initialSearchType === "doi");
            const titleChoice = makeRadioLabel("Title", "title", canUseTitle, initialSearchType === "title");
            choices.appendChild(doiChoice.label);
            choices.appendChild(titleChoice.label);

            const preview = document.createElement("div");
            preview.style.cssText = `
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 6px;
                padding: 8px;
                font-size: 12px;
                color: #334155;
                line-height: 1.35;
                word-break: break-word;
                margin-bottom: 12px;
            `;

            function updatePreview() {
                const selectedType = doiChoice.radio.checked ? "doi" : "title";
                const selectedText = getCustomSearchText(meta, selectedType);
                preview.textContent = selectedText ? `The script will search: ${selectedText}` : "No searchable DOI or title is available.";
            }

            doiChoice.radio.addEventListener("change", updatePreview);
            titleChoice.radio.addEventListener("change", updatePreview);
            updatePreview();

            const buttonRow = document.createElement("div");
            buttonRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "border:1px solid #cbd5e1;background:white;color:#334155;border-radius:6px;padding:7px 11px;font-size:13px;cursor:pointer;";

            const searchBtn = document.createElement("button");
            searchBtn.type = "button";
            searchBtn.textContent = "Search";
            searchBtn.style.cssText = "border:1px solid #193b70;background:#193b70;color:white;border-radius:6px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;";

            function close(value) {
                overlay.remove();
                resolve(value);
            }

            cancelBtn.addEventListener("click", () => close(null));
            searchBtn.addEventListener("click", () => {
                close({
                    databaseHomepage: websiteInput.value.trim(),
                    searchType: doiChoice.radio.checked ? "doi" : "title"
                });
            });
            websiteInput.addEventListener("keydown", event => {
                if (event.key === "Enter") searchBtn.click();
                if (event.key === "Escape") cancelBtn.click();
            });

            buttonRow.appendChild(cancelBtn);
            buttonRow.appendChild(searchBtn);
            dialog.appendChild(title);
            dialog.appendChild(websiteLabel);
            dialog.appendChild(websiteInput);
            dialog.appendChild(choiceLabel);
            dialog.appendChild(choices);
            dialog.appendChild(preview);
            dialog.appendChild(buttonRow);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            websiteInput.focus();
            if (!savedHomepage) websiteInput.select();
        });
    }

    function isJstorHost(hostname) {
        const host = normalizeHostForMatch(hostname);

        return (
            host === "jstor.org" ||
            host.endsWith(".jstor.org") ||
            host.includes("jstor-org") ||
            host.includes("jstor.org")
        );
    }

    function buildCustomDatabaseTargetUrl(databaseHomepage, searchText, searchType) {
        let homepageUrl;

        try {
            homepageUrl = new URL(databaseHomepage);
        } catch (e) {
            return "";
        }

        // JSTOR's normal search URL is /action/doBasicSearch?Query=...&so=rel.
        // Use the same origin the user entered, so institutional proxy URLs still work, e.g.:
        // https://www-jstor-org.libproxy.school.edu/action/doBasicSearch?Query=...&so=rel
        if (isJstorHost(homepageUrl.hostname)) {
            const jstorUrl = new URL(homepageUrl.origin + "/action/doBasicSearch");
            jstorUrl.searchParams.set("Query", searchText);
            jstorUrl.searchParams.set("so", "rel");
            return jstorUrl.href;
        }

        const separator = databaseHomepage.includes("#") ? "&" : "#";
        return databaseHomepage + separator +
            "coviCustomSearch=" + encodeURIComponent(searchText) +
            "&coviCustomSearchType=" + encodeURIComponent(searchType);
    }

    async function openCustomSearch(meta, statusEl) {
        const HOMEPAGE_STORAGE_KEY = "covi_pdf_finder_custom_database_homepage";
        const SEARCH_TYPE_STORAGE_KEY = "covi_pdf_finder_custom_search_type";

        const savedHomepage = localStorage.getItem(HOMEPAGE_STORAGE_KEY) || "";
        const savedSearchType = localStorage.getItem(SEARCH_TYPE_STORAGE_KEY) || "";

        const dialogResult = await showCustomSearchDialog(meta, savedHomepage, savedSearchType);

        if (!dialogResult) {
            setStatus(statusEl, "Custom search canceled.", "warn");
            return;
        }

        const databaseHomepage = normalizeDatabaseHomepage(dialogResult.databaseHomepage);
        if (!databaseHomepage) {
            setStatus(statusEl, "Invalid database website address.", "bad");
            return;
        }

        const searchType = dialogResult.searchType;
        const searchText = getCustomSearchText(meta, searchType);
        if (!searchText) {
            setStatus(statusEl, searchType === "doi" ? "No DOI detected for this study." : "No title detected for this study.", "bad");
            return;
        }

        localStorage.setItem(HOMEPAGE_STORAGE_KEY, databaseHomepage);
        localStorage.setItem(SEARCH_TYPE_STORAGE_KEY, searchType);

        const isJstorTarget = (() => {
            try {
                return isJstorHost(new URL(databaseHomepage).hostname);
            } catch (e) {
                return false;
            }
        })();

        const targetUrl = buildCustomDatabaseTargetUrl(databaseHomepage, searchText, searchType);

        // For JSTOR, the extension opens JSTOR's search-results URL directly.
        // Do NOT save a pending autofill task; otherwise JSTOR's search bar can
        // receive the text again and open its autocomplete dropdown.
        if (isJstorTarget) {
            await chromeStorageRemove(PENDING_CUSTOM_SEARCH_KEY);
        } else {
            let targetHost = "";
            try {
                targetHost = normalizeHostForMatch(new URL(databaseHomepage).hostname);
            } catch (e) {}

            await chromeStorageSet({
                [PENDING_CUSTOM_SEARCH_KEY]: {
                    host: targetHost,
                    searchText,
                    searchType,
                    createdAt: Date.now()
                }
            });
        }

        window.open(targetUrl, "_blank", "noopener,noreferrer");

        setStatus(
            statusEl,
            isJstorTarget
                ? `Opened JSTOR search directly using the selected ${searchType === "doi" ? "DOI" : "title"}.`
                : `Opened custom database and sent ${searchType === "doi" ? "DOI" : "title"} to the search bar.`,
            "good"
        );
    }

    async function getPendingCustomSearchFromStorage() {
        const result = await chromeStorageGet(PENDING_CUSTOM_SEARCH_KEY);
        const pending = result ? result[PENDING_CUSTOM_SEARCH_KEY] : null;
        if (!pending || !pending.searchText) return null;

        const ageMs = Date.now() - Number(pending.createdAt || 0);
        if (ageMs > 2 * 60 * 1000) {
            await chromeStorageRemove(PENDING_CUSTOM_SEARCH_KEY);
            return null;
        }

        const currentHost = normalizeHostForMatch(location.hostname);
        const targetHost = normalizeHostForMatch(pending.host);

        if (!targetHost || currentHost === targetHost || currentHost.endsWith("." + targetHost) || targetHost.endsWith("." + currentHost)) {
            return pending;
        }

        return null;
    }

    async function fillCustomDatabaseSearchBox() {
        const hash = window.location.hash || "";

        // JSTOR is handled by direct search URLs such as
        // /action/doBasicSearch?Query=...&so=rel, so the extension should not
        // autofill JSTOR's search bar. Autofill triggers JSTOR's suggestions menu.
        if (isJstorHost(location.hostname) && !hash.includes("coviCustomSearch=")) {
            await chromeStorageRemove(PENDING_CUSTOM_SEARCH_KEY);
            return;
        }

        let searchText = "";
        let searchType = "selected text";

        if (hash.includes("coviCustomSearch=")) {
            const match = hash.match(/coviCustomSearch=([^&]+)/);
            if (match && match[1]) {
                searchText = decodeURIComponent(match[1]);
            }

            const typeMatch = hash.match(/coviCustomSearchType=([^&]+)/);
            searchType = typeMatch && typeMatch[1] ? decodeURIComponent(typeMatch[1]) : "selected text";
        }

        if (!searchText) {
            const pending = await getPendingCustomSearchFromStorage();
            if (!pending) return;
            searchText = pending.searchText;
            searchType = pending.searchType || "selected text";
        }

        if (!searchText) return;

        function getDeepElements(selector) {
            const results = [];
            const seen = new Set();

            function collect(root) {
                if (!root || seen.has(root)) return;
                seen.add(root);

                try {
                    root.querySelectorAll(selector).forEach(el => results.push(el));
                } catch (e) {}

                try {
                    root.querySelectorAll("*").forEach(el => {
                        if (el.shadowRoot) collect(el.shadowRoot);
                    });
                } catch (e) {}
            }

            collect(document);
            return results;
        }

        function isUsableVisibleElement(el) {
            if (!el) return false;
            if (el.disabled) return false;
            if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;

            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;

            const rect = el.getBoundingClientRect();
            if (rect.width < 20 || rect.height < 10) return false;

            return true;
        }

        function scoreSearchInput(input) {
            const attrs = [
                input.type,
                input.name,
                input.id,
                input.placeholder,
                input.getAttribute("aria-label"),
                input.getAttribute("title"),
                input.getAttribute("role"),
                input.className
            ].join(" ").toLowerCase();

            let score = 0;
            if ((input.type || "").toLowerCase() === "search") score += 80;
            if (/search|query|keyword|keywords|jstor/.test(attrs)) score += 60;
            if (/email|password|login|username|sign in|sign-in/.test(attrs)) score -= 200;
            if (input.tagName.toLowerCase() === "textarea") score += 10;
            if (input.isContentEditable) score += 5;

            const rect = input.getBoundingClientRect();
            score += Math.min(rect.width, 600) / 20;

            return score;
        }

        function tryOpenCollapsedSearch() {
            const candidates = getDeepElements(
                'button[aria-label*="search" i], button[title*="search" i], button[class*="search" i], a[aria-label*="search" i], a[title*="search" i], a[class*="search" i]'
            ).filter(isUsableVisibleElement);

            const openButton = candidates.find(btn => {
                const text = (btn.innerText || btn.textContent || btn.getAttribute("aria-label") || btn.getAttribute("title") || "").trim().toLowerCase();
                return text === "search" || text === "open search" || text === "show search" || text.includes("search");
            });

            if (openButton) {
                try {
                    openButton.click();
                    return true;
                } catch (e) {}
            }

            return false;
        }

        function findSearchInput() {
            const selectors = [
                // JSTOR and many library databases use Query with a capital Q.
                'input[name="Query"]',
                'input[id="Query"]',
                'input[name="searchQuery"]',
                'input[id="searchQuery"]',
                'input[name="queryText"]',
                'input[type="search"]',
                'input[role="searchbox"]',
                '[contenteditable="true"][role="searchbox"]',
                'input[name="q"]',
                'input[name="query"]',
                'input[name="search"]',
                'input[id*="search" i]',
                'input[name*="search" i]',
                'input[placeholder*="search" i]',
                'input[aria-label*="search" i]',
                'textarea[placeholder*="search" i]',
                'textarea[aria-label*="search" i]',
                'textarea'
            ];

            const candidates = [];

            for (const selector of selectors) {
                candidates.push(...getDeepElements(selector));
            }

            candidates.push(...getDeepElements("input").filter(input => {
                const type = (input.type || "").toLowerCase();
                return ["text", "search", ""].includes(type);
            }));

            const uniqueCandidates = Array.from(new Set(candidates))
                .filter(isUsableVisibleElement)
                .filter(input => {
                    const type = (input.type || "").toLowerCase();
                    return !["hidden", "password", "email", "checkbox", "radio", "submit", "button"].includes(type);
                })
                .sort((a, b) => scoreSearchInput(b) - scoreSearchInput(a));

            return uniqueCandidates[0] || null;
        }

        function fillReactCompatibleInput(input, value) {
            const tagName = input.tagName.toLowerCase();

            if (input.isContentEditable) {
                input.textContent = value;
                input.dispatchEvent(new InputEvent("input", {
                    bubbles: true,
                    cancelable: true,
                    inputType: "insertText",
                    data: value
                }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                return;
            }

            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

            if (tagName === "textarea" && nativeTextAreaValueSetter) {
                nativeTextAreaValueSetter.call(input, value);
            } else if (tagName === "input" && nativeInputValueSetter) {
                nativeInputValueSetter.call(input, value);
            } else {
                input.value = value;
            }

            input.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: value
            }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        function showCustomSearchPanel(message, text) {
            const oldPanel = document.getElementById(`${SCRIPT_TAG}-custom-search-panel`);
            if (oldPanel) oldPanel.remove();

            const panel = document.createElement("div");
            panel.id = `${SCRIPT_TAG}-custom-search-panel`;
            panel.style.cssText = `
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 999999;
                background: white;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                padding: 10px 12px;
                box-shadow: 0 6px 20px rgba(0,0,0,.18);
                font-family: Arial, sans-serif;
                font-size: 13px;
                max-width: 380px;
                color: #0f172a;
            `;

            const title = document.createElement("div");
            title.textContent = "Covidence Custom Search";
            title.style.cssText = "font-weight:700; margin-bottom:6px;";
            const body = document.createElement("div");
            body.textContent = message;
            const queryBox = document.createElement("div");
            queryBox.textContent = text;
            queryBox.style.cssText = "margin-top:6px; word-break:break-word; color:#334155;";
            const tip = document.createElement("div");
            tip.textContent = "Press Enter or click the database search button if the search does not run automatically.";
            tip.style.cssText = "margin-top:8px; color:#475569;";
            panel.appendChild(title);
            panel.appendChild(body);
            panel.appendChild(queryBox);
            panel.appendChild(tip);
            document.body.appendChild(panel);
            setTimeout(() => panel.remove(), 12000);
        }

        function findSearchButton(input) {
            const root = input.getRootNode ? input.getRootNode() : document;
            const form = input.closest ? input.closest("form") : null;

            if (form) {
                const formButton = form.querySelector(
                    'button[type="submit"], input[type="submit"], button[aria-label*="search" i], button[title*="search" i], button[data-testid*="search" i]'
                );
                if (formButton && !formButton.disabled) return formButton;
            }

            const buttonSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button[aria-label*="search" i]',
                'button[title*="search" i]',
                'button[id*="search" i]',
                'button[class*="search" i]',
                'button[data-testid*="search" i]',
                'input[value*="Search" i]'
            ];

            const buttons = [];
            for (const selector of buttonSelectors) {
                try {
                    if (root && root.querySelectorAll) buttons.push(...root.querySelectorAll(selector));
                } catch (e) {}
                buttons.push(...getDeepElements(selector));
            }

            buttons.push(...getDeepElements("button, input[type='button'], input[type='submit']").filter(btn => {
                const text = (btn.innerText || btn.textContent || btn.value || btn.getAttribute("aria-label") || btn.getAttribute("title") || "").trim().toLowerCase();
                return text === "search" || text.includes("search");
            }));

            const inputRect = input.getBoundingClientRect();

            return Array.from(new Set(buttons))
                .filter(isUsableVisibleElement)
                .sort((a, b) => {
                    const ar = a.getBoundingClientRect();
                    const br = b.getBoundingClientRect();
                    const ad = Math.abs(ar.left - inputRect.right) + Math.abs(ar.top - inputRect.top);
                    const bd = Math.abs(br.left - inputRect.right) + Math.abs(br.top - inputRect.top);
                    return ad - bd;
                })[0] || null;
        }

        function submitSearch(input) {
            const searchButton = findSearchButton(input);
            if (searchButton) {
                searchButton.click();
                return true;
            }

            const form = input.closest("form");
            if (form) {
                form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                if (typeof form.submit === "function") form.submit();
                return true;
            }

            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            return true;
        }

        function fillInput(input) {
            input.focus();
            fillReactCompatibleInput(input, searchText);
            chromeStorageRemove(PENDING_CUSTOM_SEARCH_KEY);
            setTimeout(() => submitSearch(input), 800);
        }

        let attempts = 0;
        const timer = setInterval(() => {
            attempts += 1;

            if (attempts === 2 || attempts === 6 || attempts === 12) {
                tryOpenCollapsedSearch();
            }

            const input = findSearchInput();
            if (input) {
                clearInterval(timer);
                fillInput(input);
                return;
            }

            if (attempts >= 20) {
                clearInterval(timer);
            }
        }, 500);
    }

    /************************************************************
     * Google Scholar URL cleaning
     ************************************************************/

    function cleanScholarPdfUrl(rawUrl) {
        if (!rawUrl) return "";

        let url = rawUrl;

        try {
            const u = new URL(rawUrl);

            if (u.hostname.includes("google.com") && u.pathname === "/url") {
                const realUrl = u.searchParams.get("q") || u.searchParams.get("url");
                if (realUrl) {
                    url = realUrl;
                }
            }
        } catch (e) {
            return "";
        }

        try {
            const cleaned = new URL(url);

            if (cleaned.hostname.includes("accounts.google.com")) return "";
            if (/ServiceLogin/i.test(cleaned.href)) return "";

            if (
                cleaned.hostname.includes("scholar.google.com") &&
                !/\.pdf(\?|#|$)/i.test(cleaned.href)
            ) {
                return "";
            }

            if (
                cleaned.hostname.includes("google.com") &&
                !/\.pdf(\?|#|$)/i.test(cleaned.href) &&
                !/\/pdf(\/|\?|#|$)/i.test(cleaned.href)
            ) {
                return "";
            }

            return cleaned.href;
        } catch (e) {
            return "";
        }
    }

    function isLikelyUsableScholarPdfLink(a) {
        const text = (a.textContent || "").trim();
        const href = a.href || "";
        const cleanedUrl = cleanScholarPdfUrl(href);

        if (!cleanedUrl) return false;

        const looksLikePdf =
            /^\[PDF\]/i.test(text) ||
            /\.pdf(\?|#|$)/i.test(cleanedUrl) ||
            /\/pdf(\/|\?|#|$)/i.test(cleanedUrl);

        if (!looksLikePdf) return false;

        if (/accounts\.google\.com/i.test(cleanedUrl)) return false;
        if (/ServiceLogin/i.test(cleanedUrl)) return false;

        return true;
    }

    /************************************************************
     * Covidence metadata extraction
     ************************************************************/

    function extractTitleFromCard(cardText) {
        const lines = String(cardText || "")
            .split("\n")
            .map(x => x.trim())
            .filter(Boolean);

        const badStarts = [
            "Upload full text",
            "Abstract",
            "Note",
            "History",
            "Duplicate",
            "Move to screening",
            "Include",
            "Exclude",
            "DOI:",
            "Find + Download",
            "Search Options",
            "Custom Search",
            "Reset Custom Search",
            "Copy Metadata",
            "Google",
            "Google Scholar",
            "PubMed",
            "ResearchGate",
            "DOI page"
        ];

        for (const line of lines) {
            if (line.match(/^#\s*\d+\s*-/)) continue;
            if (badStarts.some(x => line.startsWith(x))) continue;
            if (line.length < 10) continue;
            if (line.includes(";")) continue;
            if (line.match(/^Journal\b/i)) continue;
            if (line.match(/^\d{4}$/)) continue;
            if (line.match(/^https?:\/\//i)) continue;
            if (/Downloaded:/i.test(line)) continue;
            if (/No open-access PDF/i.test(line)) continue;
            if (/Searching/i.test(line)) continue;

            return line.replace(/\s+/g, " ").trim();
        }

        return "";
    }

    function extractDOIFromCard(card) {
        const text = card.innerText || "";

        const doiFromText = normalizeDOI(text);

        if (doiFromText) return doiFromText;

        const links = Array.from(card.querySelectorAll("a"));

        for (const a of links) {
            const href = a.href || "";
            const linkText = a.innerText || "";
            const doi = normalizeDOI(href) || normalizeDOI(linkText);

            if (doi) return doi;
        }

        return "";
    }

    function getStudyMetadata(card) {
        const text = card.innerText || "";

        const studyNumber = extractStudyNumber(text);
        const firstAuthor = extractFirstAuthor(text);
        const year = extractYear(text);
        const title = extractTitleFromCard(text);
        const doi = extractDOIFromCard(card);

        const filename = [
            sanitizeFilenamePart(studyNumber || "study"),
            sanitizeFilenamePart(firstAuthor || "unknown-author"),
            sanitizeFilenamePart(year || "unknown-year")
        ].join("-") + ".pdf";

        return {
            studyNumber,
            firstAuthor,
            year,
            title,
            doi,
            filename
        };
    }

    /************************************************************
     * Open-access PDF search
     ************************************************************/

    async function findViaUnpaywall(doi) {
        if (!doi) return null;

        const apiUrl =
            "https://api.unpaywall.org/v2/" +
            encodeURIComponent(doi) +
            "?email=" +
            encodeURIComponent(UNPAYWALL_EMAIL);

        const data = await requestJSON(apiUrl);

        if (data && data.best_oa_location && data.best_oa_location.url_for_pdf) {
            return {
                source: "Unpaywall",
                pdfUrl: data.best_oa_location.url_for_pdf
            };
        }

        if (data && Array.isArray(data.oa_locations)) {
            for (const location of data.oa_locations) {
                if (location.url_for_pdf) {
                    return {
                        source: "Unpaywall",
                        pdfUrl: location.url_for_pdf
                    };
                }
            }
        }

        return null;
    }

    async function findViaEuropePMC(meta) {
        const queryParts = [];

        if (meta.doi) {
            queryParts.push(`DOI:"${meta.doi}"`);
        }

        if (meta.title) {
            queryParts.push(`TITLE:"${meta.title}"`);
        }

        if (!queryParts.length) return null;

        const query = queryParts.join(" OR ");

        const url =
            "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=" +
            encodeURIComponent(query) +
            "&format=json&pageSize=5";

        const data = await requestJSON(url);

        const results = data &&
            data.resultList &&
            Array.isArray(data.resultList.result)
            ? data.resultList.result
            : [];

        for (const item of results) {
            if (item.fullTextUrlList && Array.isArray(item.fullTextUrlList.fullTextUrl)) {
                for (const ft of item.fullTextUrlList.fullTextUrl) {
                    const pdfUrl = ft.url;
                    const documentStyle = (ft.documentStyle || "").toLowerCase();

                    if (pdfUrl && (documentStyle === "pdf" || isProbablyPDFUrl(pdfUrl))) {
                        return {
                            source: "Europe PMC",
                            pdfUrl
                        };
                    }
                }
            }

            if (item.pmcid) {
                const pmcPdfUrl = `https://pmc.ncbi.nlm.nih.gov/articles/${item.pmcid}/pdf/`;

                return {
                    source: "PubMed Central",
                    pdfUrl: pmcPdfUrl
                };
            }
        }

        return null;
    }

    async function findViaDOILandingPage(doi) {
        if (!doi) return null;

        const doiUrl = "https://doi.org/" + encodeURIComponent(doi);
        const page = await requestText(doiUrl);

        if (!page || !page.text) return null;

        const html = page.text;
        const baseUrl = page.finalUrl || doiUrl;

        const pdfCandidates = [];

        const citationPdfMatch =
            html.match(/name\s*=\s*["']citation_pdf_url["'][^>]*content\s*=\s*["']([^"']+)["']/i) ||
            html.match(/content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']citation_pdf_url["']/i);

        if (citationPdfMatch && citationPdfMatch[1]) {
            const absolute = absolutizeUrl(citationPdfMatch[1], baseUrl);

            if (absolute) {
                pdfCandidates.push(absolute);
            }
        }

        const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
        let match;

        while ((match = hrefRegex.exec(html)) !== null) {
            const href = match[1];
            const absolute = absolutizeUrl(href, baseUrl);

            if (absolute && isProbablyPDFUrl(absolute)) {
                pdfCandidates.push(absolute);
            }
        }

        const uniquePdfCandidates = Array.from(new Set(pdfCandidates));

        if (uniquePdfCandidates.length > 0) {
            return {
                source: "DOI landing page",
                pdfUrl: uniquePdfCandidates[0]
            };
        }

        return null;
    }

    async function findOpenAccessPDF(meta, statusEl) {
        const attempts = [];

        if (meta.doi) {
            attempts.push({
                name: "Unpaywall",
                run: () => findViaUnpaywall(meta.doi)
            });
        }

        attempts.push({
            name: "Europe PMC / PubMed Central",
            run: () => findViaEuropePMC(meta)
        });

        if (meta.doi) {
            attempts.push({
                name: "DOI landing page",
                run: () => findViaDOILandingPage(meta.doi)
            });
        }

        for (const attempt of attempts) {
            setStatus(statusEl, `Searching ${attempt.name}...`, "warn");

            try {
                const result = await attempt.run();

                if (result && result.pdfUrl) {
                    return result;
                }
            } catch (error) {
                console.warn(`[${SCRIPT_TAG}] ${attempt.name} failed:`, error);
            }

            await sleep(400);
        }

        return null;
    }

    /************************************************************
     * Safe PDF validation + download
     ************************************************************/

    async function downloadPDF(pdfUrl, filename, statusEl) {
        setStatus(statusEl, "Checking PDF before downloading...", "warn");

        try {
            const response = await extensionRequest({
                action: "downloadPdf",
                url: pdfUrl,
                filename
            });

            setStatus(statusEl, `Downloaded valid PDF: ${response.filename || filename}`, "good");
            return true;
        } catch (error) {
            const message = error && error.message ? error.message : "Could not download the PDF directly.";
            setStatus(statusEl, `${message} Opening link manually instead.`, "warn");

            if (!/accounts\.google\.com|ServiceLogin/i.test(pdfUrl)) {
                window.open(pdfUrl, "_blank", "noopener,noreferrer");
            }

            throw error;
        }
    }

    async function handleFindAndDownload(card, statusEl) {
        const meta = getStudyMetadata(card);

        console.log(`[${SCRIPT_TAG}] metadata`, meta);

        if (!meta.doi && !meta.title) {
            setStatus(statusEl, "Could not detect DOI or title for this study.", "bad");

            return {
                ok: false,
                reason: "No DOI or title detected.",
                meta
            };
        }

        const summary = [
            meta.studyNumber ? `#${meta.studyNumber}` : "",
            meta.firstAuthor || "",
            meta.year || "",
            meta.doi ? `DOI: ${meta.doi}` : "No DOI detected"
        ].filter(Boolean).join(" | ");

        setStatus(statusEl, `Searching open-access PDF sources for ${summary}...`, "warn");

        const result = await findOpenAccessPDF(meta, statusEl);

        if (!result || !result.pdfUrl) {
            setStatus(
                statusEl,
                "No PDF found from open-access sources. Opening Google Scholar fallback...",
                "warn"
            );

            openSearchSite("scholar", meta, statusEl);

            return {
                ok: false,
                reason: "No PDF found from open-access sources; Google Scholar fallback opened.",
                meta
            };
        }

        setStatus(statusEl, `Found PDF via ${result.source}: ${result.pdfUrl}`, "good");

        try {
            await downloadPDF(result.pdfUrl, meta.filename, statusEl);

            return {
                ok: true,
                source: result.source,
                pdfUrl: result.pdfUrl,
                filename: meta.filename,
                meta
            };
        } catch (error) {
            return {
                ok: false,
                reason: "PDF found but download failed validation.",
                source: result.source,
                pdfUrl: result.pdfUrl,
                filename: meta.filename,
                meta
            };
        }
    }

    /************************************************************
     * Manual search menu
     ************************************************************/

    function openSearchSite(site, meta, statusEl) {
        const cleanTitle = cleanTitleForSearch(meta.title);

        // Google Search still uses quotes for more precise searching.
        const titleQuery = cleanTitle ? `"${cleanTitle}"` : "";
        const doiQuery = meta.doi ? `"${meta.doi}"` : "";
        const generalQuery = meta.doi ? doiQuery : titleQuery;

        // Google Scholar should NOT use quotes.
        // Prefer title first for Scholar; use DOI only if title is unavailable.
        const scholarQuery = cleanTitle || meta.doi || "";

        let url = "";

        switch (site) {
            case "google":
                if (cleanTitle) {
                    url = "https://www.google.com/search?q=" + encodeURIComponent(`${cleanTitle} pdf`);
                } else if (meta.doi) {
                    url = "https://www.google.com/search?q=" + encodeURIComponent(`${meta.doi} pdf`);
                } else {
                    setStatus(statusEl, "No title or DOI detected for this study.", "bad");
                    return;
                }
                break;

            case "scholar":
                if (!scholarQuery) {
                    setStatus(statusEl, "No title or DOI detected for this study.", "bad");
                    return;
                }

                url =
                    "https://scholar.google.com/scholar?q=" +
                    encodeURIComponent(scholarQuery) +
                    "&covi_filename=" +
                    encodeURIComponent(meta.filename);
                break;

            case "researchgate":
                if (cleanTitle) {
                    url = "https://www.researchgate.net/search/publication?q=" + encodeURIComponent(cleanTitle);
                } else if (meta.doi) {
                    url = "https://www.researchgate.net/search/publication?q=" + encodeURIComponent(meta.doi);
                } else {
                    setStatus(statusEl, "No title or DOI detected for this study.", "bad");
                    return;
                }
                break;

            case "openalex":
                if (cleanTitle) {
                    url =
                        "https://openalex.org/works?search.title_and_abstract=" +
                        encodeURIComponent(cleanTitle) +
                        "&page=1&sort=relevance_score:desc";
                } else {
                    setStatus(statusEl, "No title detected for this study.", "bad");
                    return;
                }
                break;

            case "doi":
                if (meta.doi) {
                    url = "https://doi.org/" + encodeURIComponent(meta.doi);
                } else {
                    setStatus(statusEl, "No DOI detected for this study.", "bad");
                    return;
                }
                break;

            case "customsearch":
                openCustomSearch(meta, statusEl);
                return;

            default:
                setStatus(statusEl, "Unknown search option.", "bad");
                return;
        }

        if (!url) {
            setStatus(statusEl, "Could not create search URL because no title or DOI was detected.", "bad");
            return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
        setStatus(statusEl, `Opened ${site} search in a new tab.`, "good");
    }

    function makeSearchOptionsControl(card, statusEl) {
        const wrap = document.createElement("span");
        wrap.className = `${SCRIPT_TAG}-search-wrap`;

        const btn = makeButton("Search Options ▾", "secondary", event => {
            event.stopPropagation();

            document.querySelectorAll(`.${SCRIPT_TAG}-menu.open`).forEach(menu => {
                if (menu !== menuEl) {
                    menu.classList.remove("open");
                }
            });

            menuEl.classList.toggle("open");
        });

        const menuEl = document.createElement("div");
        menuEl.className = `${SCRIPT_TAG}-menu`;

        const options = [
            { label: "Google Search", site: "google" },
            { label: "Google Scholar", site: "scholar" },
            { label: "ResearchGate", site: "researchgate" },
            { label: "OpenAlex", site: "openalex" },
            { label: "DOI Page", site: "doi" },
            { label: "Custom Search", site: "customsearch" }
        ];

        options.forEach(option => {
            const item = document.createElement("button");
            item.type = "button";
            item.textContent = option.label;

            item.addEventListener("click", event => {
                event.stopPropagation();

                const meta = getStudyMetadata(card);
                openSearchSite(option.site, meta, statusEl);
                menuEl.classList.remove("open");
            });

            menuEl.appendChild(item);
        });

        wrap.appendChild(btn);
        wrap.appendChild(menuEl);

        return wrap;
    }

    document.addEventListener("click", () => {
        document.querySelectorAll(`.${SCRIPT_TAG}-menu.open`).forEach(menu => {
            menu.classList.remove("open");
        });
    });

    /************************************************************
     * Covidence UI injection
     ************************************************************/

    function findStudyCards() {
        const allElements = Array.from(document.querySelectorAll("div, article, li, section"));

        const possibleCards = allElements.filter(el => {
            const text = el.innerText || "";

            if (!/Upload full text/i.test(text)) return false;
            if (!/Include/i.test(text)) return false;
            if (!/Exclude/i.test(text)) return false;
            if (!/#\s*\d+/.test(text)) return false;

            return true;
        });

        const singleStudyCards = possibleCards.filter(el => {
            const text = el.innerText || "";

            const studyCount = (text.match(/#\s*\d+\s*-/g) || []).length;
            const uploadCount = (text.match(/Upload full text/gi) || []).length;

            return studyCount === 1 && uploadCount === 1;
        });

        const finalCards = [];

        for (const card of singleStudyCards) {
            const isInsideExistingCard = finalCards.some(existing => existing.contains(card));
            const containsExistingCard = finalCards.some(existing => card.contains(existing));

            if (isInsideExistingCard) {
                continue;
            }

            if (containsExistingCard) {
                for (let i = finalCards.length - 1; i >= 0; i--) {
                    if (card.contains(finalCards[i])) {
                        finalCards.splice(i, 1);
                    }
                }
            }

            finalCards.push(card);
        }

        return finalCards;
    }

    function addControlsToCard(card) {
        if (!card) return;

        if (card.querySelector(`.${SCRIPT_TAG}-box`)) {
            return;
        }

        const text = card.innerText || "";

        const looksLikeStudyCard =
            /Upload full text/i.test(text) &&
            /Include/i.test(text) &&
            /Exclude/i.test(text) &&
            /#\s*\d+/.test(text);

        if (!looksLikeStudyCard) return;

        const box = document.createElement("div");
        box.className = `${SCRIPT_TAG}-box`;

        const statusEl = document.createElement("span");
        statusEl.className = `${SCRIPT_TAG}-status`;
        statusEl.textContent = "";

        const findBtn = makeButton("Find + Download PDF", "", async () => {
            findBtn.disabled = true;
            findBtn.textContent = "Searching...";

            try {
                await handleFindAndDownload(card, statusEl);
            } finally {
                findBtn.disabled = false;
                findBtn.textContent = "Find + Download PDF";
            }
        });

        const searchOptions = makeSearchOptionsControl(card, statusEl);

        box.appendChild(findBtn);
        box.appendChild(searchOptions);
        box.appendChild(statusEl);

        const uploadButton = Array.from(card.querySelectorAll("button, a"))
            .find(el => /Upload full text/i.test(el.innerText || ""));

        if (uploadButton && uploadButton.parentElement) {
            uploadButton.parentElement.insertAdjacentElement("afterend", box);
        } else {
            card.appendChild(box);
        }
    }

    function scanAndAttachControls() {
        const cards = findStudyCards();

        cards.forEach(card => {
            if (!card.querySelector(`.${SCRIPT_TAG}-box`)) {
                addControlsToCard(card);
            }
        });

        console.log(`[${SCRIPT_TAG}] ${cards.length} visible study card(s) detected.`);
    }

    function startLightPageWatcher() {
        setInterval(() => {
            scanAndAttachControls();
        }, 5000);
    }

    /************************************************************
     * Google Scholar helper page
     ************************************************************/

    function initGoogleScholarPdfHelper() {
        if (!location.hostname.includes("scholar.google.com")) return;
        if (document.getElementById(`${SCRIPT_TAG}-scholar-helper`)) return;

        const params = new URL(location.href).searchParams;
        const coviFilename = params.get("covi_filename") || "covidence-scholar-pdf.pdf";

        const pdfLinks = Array.from(document.querySelectorAll("a"))
            .filter(isLikelyUsableScholarPdfLink)
            .map(a => ({
                text: (a.textContent || "PDF").trim(),
                url: cleanScholarPdfUrl(a.href)
            }));

        const uniquePdfLinks = [];
        const seen = new Set();

        for (const item of pdfLinks) {
            if (!item.url || seen.has(item.url)) continue;
            seen.add(item.url);
            uniquePdfLinks.push(item);
        }

        const panel = document.createElement("div");
        panel.id = `${SCRIPT_TAG}-scholar-helper`;

        const title = document.createElement("div");
        title.id = `${SCRIPT_TAG}-scholar-helper-title`;
        title.textContent = "Covidence Scholar PDF Helper";
        panel.appendChild(title);

        const info = document.createElement("div");
        info.className = `${SCRIPT_TAG}-scholar-info`;

        info.textContent = uniquePdfLinks.length
            ? `${uniquePdfLinks.length} usable PDF link(s) detected.`
            : "No usable direct PDF link detected on this Scholar page. Scholar may be showing login/redirect links instead of direct PDFs.";

        panel.appendChild(info);

        const filenameBox = document.createElement("div");
        filenameBox.className = `${SCRIPT_TAG}-scholar-filename`;
        filenameBox.textContent = `Filename: ${coviFilename}`;
        panel.appendChild(filenameBox);

        if (uniquePdfLinks.length) {
            uniquePdfLinks.forEach((item, index) => {
                const row = document.createElement("div");
                row.className = `${SCRIPT_TAG}-scholar-row`;

                const openBtn = document.createElement("button");
                openBtn.textContent = `Open PDF ${index + 1}`;
                openBtn.className = `${SCRIPT_TAG}-scholar-small-btn`;

                openBtn.onclick = () => {
                    const safeUrl = cleanScholarPdfUrl(item.url);

                    if (!safeUrl) {
                        info.textContent = "This link is a Google login/redirect link, not a direct PDF.";
                        info.style.color = "#991b1b";
                        info.style.fontWeight = "700";
                        return;
                    }

                    window.open(safeUrl, "_blank", "noopener,noreferrer");
                };

                const downloadBtn = document.createElement("button");
                downloadBtn.textContent = "Download after validation";
                downloadBtn.className = `${SCRIPT_TAG}-scholar-small-btn primary`;

                downloadBtn.onclick = async () => {
                    const safeUrl = cleanScholarPdfUrl(item.url);

                    if (!safeUrl) {
                        info.textContent = "This link is a Google login/redirect link, not a direct PDF.";
                        info.style.color = "#991b1b";
                        info.style.fontWeight = "700";
                        return;
                    }

                    downloadBtn.disabled = true;
                    downloadBtn.textContent = "Checking...";

                    info.textContent = "Checking PDF before downloading...";
                    info.style.color = "#92400e";
                    info.style.fontWeight = "700";

                    const fakeStatusEl = document.createElement("span");

                    try {
                        await downloadPDF(safeUrl, coviFilename, fakeStatusEl);

                        info.textContent = `Downloaded valid PDF: ${coviFilename}`;
                        info.style.color = "#166534";
                        info.style.fontWeight = "700";
                    } catch (error) {
                        info.textContent = "This link did not return a valid PDF. Try opening it manually.";
                        info.style.color = "#991b1b";
                        info.style.fontWeight = "700";
                    } finally {
                        downloadBtn.disabled = false;
                        downloadBtn.textContent = "Download after validation";
                    }
                };

                const label = document.createElement("div");
                label.className = `${SCRIPT_TAG}-scholar-link-label`;
                label.textContent = item.text + " — " + item.url;

                row.appendChild(openBtn);
                row.appendChild(downloadBtn);
                row.appendChild(label);
                panel.appendChild(row);
            });
        } else {
            const manualTip = document.createElement("div");
            manualTip.className = `${SCRIPT_TAG}-scholar-info`;
            manualTip.textContent =
                "Try clicking the article title, publisher page, or All versions manually. The visible Scholar links on this page are probably not direct PDF links.";
            panel.appendChild(manualTip);
        }

        document.body.appendChild(panel);
        makeDraggable(panel, title);
    }

    function waitForScholarReady(cb) {
        if (!location.hostname.includes("scholar.google.com")) return;

        if (document.querySelector("#gs_top") || document.querySelector(".gs_r")) {
            setTimeout(cb, 500);
            return;
        }

        const obs = new MutationObserver(() => {
            if (document.querySelector("#gs_top") || document.querySelector(".gs_r")) {
                obs.disconnect();
                setTimeout(cb, 500);
            }
        });

        obs.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /************************************************************
     * Init router
     ************************************************************/

    async function init() {
        if (IS_SCHOLAR) {
            waitForScholarReady(initGoogleScholarPdfHelper);
            return;
        }

        if (IS_COVIDENCE) {
            scanAndAttachControls();
            startLightPageWatcher();
            return;
        }

        // On all other pages, do almost nothing unless this page was opened
        // by the Custom Search dialog. This fixes sites such as JSTOR that
        // may load at https://www.jstor.org/ without preserving the hash.
        await fillCustomDatabaseSearchBox();
    }

    init();

})();