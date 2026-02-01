import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const SAFE_ENTRY_NAME = /^[a-zA-Z0-9._-]+$/;

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const data = fs.readFileSync(envPath, "utf8");
  for (const line of data.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    if (!key) continue;
    const raw = rest.join("=").trim();
    if (process.env[key] !== undefined) continue;
    const value = raw.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    process.env[key] = value;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { source: "auto", project: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--source" && args[i + 1]) {
      result.source = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--source=")) {
      result.source = arg.split("=")[1] || "auto";
      continue;
    }
    if (arg === "--project" && args[i + 1]) {
      result.project = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--project=")) {
      result.project = arg.split("=")[1] || null;
    }
  }
  return result;
}

function inferContentTypeFromName(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function streamToBuffer(body) {
  if (!body) return Buffer.from("");
  if (typeof body.transformToByteArray === "function") {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  const readable = body;
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function ensureBucketExists(client, bucketName) {
  const { data, error } = await client.storage.listBuckets();
  if (error) {
    console.warn(`[migrate] unable to list buckets: ${error.message}`);
    return;
  }
  if (data?.some((bucket) => bucket.name === bucketName)) return;
  const { error: createError } = await client.storage.createBucket(bucketName, { public: false });
  if (createError) {
    throw new Error(`Unable to create bucket ${bucketName}: ${createError.message}`);
  }
  console.log(`[migrate] created bucket ${bucketName}`);
}

async function migrateFromLocal({ supabase, bucket, projectFilter }) {
  const outputDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    console.log("[migrate] no local output directory found, skipping local migration");
    return { uploaded: 0 };
  }

  const entries = await fsp.readdir(outputDir, { withFileTypes: true });
  let uploaded = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_ENTRY_NAME.test(entry.name)) continue;
    if (projectFilter && entry.name !== projectFilter) continue;

    const projectDir = path.join(outputDir, entry.name);
    const files = await fsp.readdir(projectDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !SAFE_ENTRY_NAME.test(file.name)) continue;
      const fullPath = path.join(projectDir, file.name);
      const content = await fsp.readFile(fullPath);
      const key = `${entry.name}/${file.name}`;
      const { error } = await supabase.storage.from(bucket).upload(key, content, {
        contentType: inferContentTypeFromName(file.name),
        upsert: true,
      });
      if (error) {
        throw new Error(`Upload failed for ${key}: ${error.message}`);
      }
      uploaded += 1;
      if (uploaded % 50 === 0) {
        console.log(`[migrate] uploaded ${uploaded} files so far...`);
      }
    }
  }

  return { uploaded };
}

async function listAllR2Objects(client, bucket, prefix) {
  let token;
  const results = [];
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    if (response.Contents) results.push(...response.Contents);
    token = response.IsTruncated ? response.NextContinuationToken ?? undefined : undefined;
  } while (token);
  return results;
}

async function migrateFromR2({ supabase, bucket, projectFilter }) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const r2Bucket = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !r2Bucket) {
    throw new Error("Missing R2 env vars for migration");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const objects = await listAllR2Objects(client, r2Bucket, projectFilter ? `${projectFilter}/` : undefined);
  let uploaded = 0;

  for (const item of objects) {
    const key = item.Key ?? "";
    const parts = key.split("/");
    if (parts.length < 2) continue;
    const [projectId, ...rest] = parts;
    const fileName = rest.join("/");
    if (!SAFE_ENTRY_NAME.test(projectId) || !SAFE_ENTRY_NAME.test(fileName)) continue;

    const response = await client.send(
      new GetObjectCommand({
        Bucket: r2Bucket,
        Key: key,
      }),
    );
    const body = await streamToBuffer(response.Body);
    const contentType = response.ContentType ?? inferContentTypeFromName(fileName);
    const { error } = await supabase.storage.from(bucket).upload(key, body, {
      contentType,
      upsert: true,
    });
    if (error) {
      throw new Error(`Upload failed for ${key}: ${error.message}`);
    }
    uploaded += 1;
    if (uploaded % 50 === 0) {
      console.log(`[migrate] uploaded ${uploaded} files so far...`);
    }
  }

  return { uploaded };
}

async function main() {
  loadEnvFile();
  const args = parseArgs();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET ?? process.env.SUPABASE_ANON_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;

  if (!supabaseUrl || !supabaseKey || !bucket) {
    console.error("[migrate] missing SUPABASE_URL, SUPABASE_STORAGE_BUCKET, or key env vars");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  await ensureBucketExists(supabase, bucket);

  const hasR2Env =
    process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME;
  const source = args.source === "auto" ? (hasR2Env ? "r2" : "local") : args.source;

  console.log(`[migrate] source=${source}`);
  if (args.project) {
    console.log(`[migrate] project filter=${args.project}`);
  }

  let result;
  if (source === "r2") {
    result = await migrateFromR2({ supabase, bucket, projectFilter: args.project });
  } else if (source === "local") {
    result = await migrateFromLocal({ supabase, bucket, projectFilter: args.project });
  } else {
    throw new Error(`Unknown source: ${source}`);
  }

  console.log(`[migrate] done. uploaded=${result.uploaded}`);
}

main().catch((err) => {
  console.error(`[migrate] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
