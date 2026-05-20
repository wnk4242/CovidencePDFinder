function headerValue(headers, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === lower) return value || "";
  }
  return "";
}

function firstBytesAsText(buffer, maxBytes = 16) {
  const bytes = new Uint8Array(buffer.slice(0, maxBytes));
  return Array.from(bytes).map(byte => String.fromCharCode(byte)).join("");
}

function looksLikeRealPDF(buffer, contentType) {
  if (!buffer || buffer.byteLength < 1000) {
    return { ok: false, reason: "Downloaded file is too small." };
  }

  const headerText = firstBytesAsText(buffer);
  const type = String(contentType || "").toLowerCase();

  if (headerText.startsWith("%PDF")) {
    return { ok: true, reason: "PDF signature detected." };
  }

  if (type.includes("application/pdf") && buffer.byteLength > 10000) {
    return { ok: true, reason: "PDF content type detected." };
  }

  if (/^\s*<!doctype html/i.test(headerText) || /^\s*<html/i.test(headerText)) {
    return { ok: false, reason: "The link returned an HTML page, not a PDF." };
  }

  return { ok: false, reason: "The downloaded file does not look like a real PDF." };
}

function arrayBufferToDataUrl(buffer, mimeType) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return `data:${mimeType || "application/pdf"};base64,${btoa(binary)}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "follow"
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("Could not parse JSON response.");
  }

  return {
    ok: true,
    status: response.status,
    finalUrl: response.url || url,
    data
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow"
  });

  return {
    ok: true,
    status: response.status,
    finalUrl: response.url || url,
    text: await response.text()
  };
}

async function downloadPdf(url, filename) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/pdf,application/octet-stream,*/*"
    },
    redirect: "follow"
  });

  const buffer = await response.arrayBuffer();
  const contentType = headerValue(response.headers, "content-type");
  const check = looksLikeRealPDF(buffer, contentType);

  if (!check.ok) {
    throw new Error(check.reason);
  }

  const dataUrl = arrayBufferToDataUrl(buffer, "application/pdf");

  await chrome.downloads.download({
    url: dataUrl,
    filename: filename || "covidence-paper.pdf",
    saveAs: false,
    conflictAction: "uniquify"
  });

  return {
    ok: true,
    filename: filename || "covidence-paper.pdf"
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.action) {
      throw new Error("Missing extension action.");
    }

    if (message.action === "fetchJson") {
      return await fetchJson(message.url);
    }

    if (message.action === "fetchText") {
      return await fetchText(message.url);
    }

    if (message.action === "downloadPdf") {
      return await downloadPdf(message.url, message.filename);
    }

    throw new Error(`Unknown extension action: ${message.action}`);
  })()
    .then(result => sendResponse(result))
    .catch(error => sendResponse({
      ok: false,
      error: error && error.message ? error.message : String(error)
    }));

  return true;
});
