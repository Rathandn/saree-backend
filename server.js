// backend/server.js
require("dotenv").config();
const { Redis } = require("@upstash/redis");
const express = require("express");
const { google } = require("googleapis");
const cors = require("cors");
const cloudinary = require("cloudinary").v2;

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Connect to Upstash Redis (REST API)
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ✅ Google Drive setup
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
    universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
  },
  scopes: SCOPES,
});

const drive = google.drive({ version: "v3", auth });

// ✅ Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Root folder in Google Drive
const ROOT_FOLDER_ID = "1D5KfQhDqL0gz3ymI1QWrVyzu_uwe385_";

// ------------------ Helpers ------------------

// List folders inside a parent folder
async function listFolders(parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
  });
  return res.data.files;
}

// Get a Cloudinary URL for a Google Drive file (upload if not cached yet)
async function getCloudinaryUrl(fileId, fileName) {
  // 1. Check Redis cache
  let cachedUrl = await redis.get(`image_url:${fileId}`);
  if (cachedUrl) return cachedUrl;

  console.log(`⚡ Uploading ${fileId} (${fileName}) to Cloudinary...`);

  // 2. Get Google Drive file stream
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  // 3. Upload to Cloudinary
  const uploadPromise = new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "sarees",
        public_id: fileId,
        resource_type: "image",
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    response.data.pipe(stream);
  });

  const cloudinaryUrl = await uploadPromise;

  // 4. Save to Redis for 24h
  await redis.set(`image_url:${fileId}`, cloudinaryUrl, { ex: 86400 });

  return cloudinaryUrl;
}

// List files in a folder and ensure Cloudinary URLs
async function listFiles(folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name, mimeType)",
  });

  const files = res.data.files;

  // Generate Cloudinary URLs for all files
  const products = [];
  for (const f of files) {
    const cloudinaryUrl = await getCloudinaryUrl(f.id, f.name);
    products.push({
      id: f.id,
      name: f.name.replace(/\.[^/.]+$/, ""),
      category: "Default",
      range: "1-2k",
      price: "₹1500",
      image: cloudinaryUrl,
    });
  }

  return products;
}

// ------------------ APIs ------------------

// ✅ Get full catalog (with Cloudinary URLs + Redis caching)
app.get("/api/catalog", async (req, res) => {
  try {
    const cacheKey = "saree_catalog";

    // 1. Check Redis first
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log("📦 Cache hit for catalog");
      return res.json(cached);
    }

    console.log("⚡ Cache miss - fetching from Google Drive");

    // 2. Fetch categories and subfolders
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

    // 3. Save in Redis (cache 10 min)
    await redis.set(cacheKey, catalog, { ex: 600 });

    res.json(catalog);
  } catch (err) {
    console.error("❌ Error fetching catalog:", err.message);
    res.status(500).send("Error fetching catalog");
  }
});

// ------------------ Start Server ------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ Backend running on http://localhost:${PORT}`)
);





// // backend/server.js
// require("dotenv").config();
// const { Redis } = require("@upstash/redis");
// const express = require("express");
// const { google } = require("googleapis");
// const path = require("path");
// const cors = require("cors");

// const app = express();
// app.use(cors());
// app.use(express.json());

// // ✅ Connect to Upstash Redis (REST API)
// const redis = new Redis({
//   url: process.env.UPSTASH_REDIS_REST_URL,
//   token: process.env.UPSTASH_REDIS_REST_TOKEN,
// });

// // ✅ Google Drive setup
// const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
// const auth = new google.auth.GoogleAuth({
//   credentials: {
//     type: process.env.GOOGLE_TYPE,
//     project_id: process.env.GOOGLE_PROJECT_ID,
//     private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
//     private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
//     client_email: process.env.GOOGLE_CLIENT_EMAIL,
//     client_id: process.env.GOOGLE_CLIENT_ID,
//     auth_uri: process.env.GOOGLE_AUTH_URI,
//     token_uri: process.env.GOOGLE_TOKEN_URI,
//     auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
//     client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
//     universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
//   },
//   scopes: SCOPES,
// });

// const drive = google.drive({ version: "v3", auth });

// // Root folder
// const ROOT_FOLDER_ID = "1D5KfQhDqL0gz3ymI1QWrVyzu_uwe385_";

// // ------------------ Helpers ------------------
// async function listFolders(parentId) {
//   const res = await drive.files.list({
//     q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
//     fields: "files(id, name)",
//   });
//   return res.data.files;
// }

// async function listFiles(folderId) {
//   const res = await drive.files.list({
//     q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
//     fields: "files(id, name, mimeType)",
//   });
//   return res.data.files.map((f) => ({
//     id: f.id,
//     name: f.name.replace(/\.[^/.]+$/, ""),
//     category: "Default",
//     range: "1-2k",
//     price: "₹1500",
//     image: `https://saree-backend-j7zj.onrender.com/api/image/${f.id}`, // served via backend
//   }));
// }

// // ------------------ APIs ------------------

// // ✅ Stream image (cache mimeType in Redis)
// app.get("/api/image/:id", async (req, res) => {
//   try {
//     const fileId = req.params.id;

//     // Check Redis for mimeType
//     let mimeType = await redis.get(`image_meta:${fileId}`);

//     if (mimeType) {
//       console.log(`📦 Cache hit for image meta ${fileId}`);
//     } else {
//       console.log(`⚡ Fetching Google Drive meta for ${fileId}`);
//       const meta = await drive.files.get({
//         fileId,
//         fields: "mimeType, name",
//       });
//       mimeType = meta.data.mimeType || "application/octet-stream";

//       // Cache mimeType for 1h
//       await redis.set(`image_meta:${fileId}`, mimeType, { ex: 3600 });
//     }

//     // Fetch image stream
//     const response = await drive.files.get(
//       { fileId, alt: "media" },
//       { responseType: "stream" }
//     );

//     res.setHeader("Content-Type", mimeType);
//     response.data.pipe(res);
//   } catch (err) {
//     console.error("❌ Error fetching image:", err.message);
//     res.status(500).send("Error fetching image");
//   }
// });

// // ✅ Get full catalog (with Redis caching)
// app.get("/api/catalog", async (req, res) => {
//   try {
//     const cacheKey = "saree_catalog";

//     // Check Redis first
//     const cached = await redis.get(cacheKey);
//     if (cached) {
//       console.log("📦 Cache hit for catalog");
//       return res.json(cached); // Upstash auto-parses JSON
//     }

//     console.log("⚡ Cache miss - fetching from Google Drive");

//     // Fetch categories and subfolders
//     const categories = await listFolders(ROOT_FOLDER_ID);

//     const catalog = [];
//     for (const category of categories) {
//       const subfolders = await listFolders(category.id);

//       const subfolderData = [];
//       for (const sub of subfolders) {
//         const files = await listFiles(sub.id);

//         subfolderData.push({
//           id: sub.id,
//           name: sub.name,
//           preview: files.slice(0, 5),
//           all: files,
//         });
//       }

//       catalog.push({
//         id: category.id,
//         name: category.name,
//         subfolders: subfolderData,
//       });
//     }

//     // Save in Redis (cache for 10 min)
//     await redis.set(cacheKey, catalog, { ex: 600 });

//     res.json(catalog);
//   } catch (err) {
//     console.error("❌ Error fetching catalog:", err.message);
//     res.status(500).send("Error fetching catalog");
//   }
// });

// // ------------------ Start Server ------------------
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () =>
//   console.log(`✅ Backend running on http://localhost:${PORT}`)
// );
