// backend/server.js
require('dotenv').config();
const express = require("express");
const { google } = require("googleapis");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const KEYFILEPATH = path.join(__dirname, "service-account.json");
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

const auth = new google.auth.GoogleAuth({
   credentials: {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id:process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
    universe_domain:process.env.GOOGLE_UNIVERSE_DOMAIN
  },
  scopes: SCOPES,
});

const drive = google.drive({ version: "v3", auth });

// Root folder
const ROOT_FOLDER_ID = "1D5KfQhDqL0gz3ymI1QWrVyzu_uwe385_";

// List folders
async function listFolders(parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
  });
  return res.data.files;
}

// List files inside a folder
async function listFiles(folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name, mimeType)",
  });
  return res.data.files.map((f) => ({
    id: f.id,
    name: f.name.replace(/\.[^/.]+$/, ""),
    category: "Default",
    range: "1-2k",
    price: "₹1500",
    // ✅ Serve via backend
    image: `http://localhost:5000/api/image/${f.id}`,
  }));
}

// API: stream image
app.get("/api/image/:id", async (req, res) => {
  try {
    const fileId = req.params.id;

    // Get metadata
    const meta = await drive.files.get({
      fileId,
      fields: "mimeType, name",
    });

    const mimeType = meta.data.mimeType || "application/octet-stream";

    // Get stream
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    res.setHeader("Content-Type", mimeType);
    response.data.pipe(res);
  } catch (err) {
    console.error("Error fetching image:", err.message);
    res.status(500).send("Error fetching image");
  }
});

// API: Get full catalog
app.get("/api/catalog", async (req, res) => {
  try {
    const categories = await listFolders(ROOT_FOLDER_ID);

    const catalog = [];
    for (const category of categories) {
      const subfolders = await listFolders(category.id);

      const subfolderData = [];
      for (const sub of subfolders) {
        const files = await listFiles(sub.id);

        subfolderData.push({
          id: sub.id,
          name: sub.name,
          preview: files.slice(0, 5),
          all: files,
        });
      }

      catalog.push({
        id: category.id,
        name: category.name,
        subfolders: subfolderData,
      });
    }

    res.json(catalog);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching catalog");
  }
});

const PORT = 5000;
app.listen(PORT, () =>
  console.log(`✅ Backend running on http://localhost:${PORT}`)
);
