import { S3Client } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;

export const isR2Enabled =
  Boolean(accountId) && Boolean(accessKeyId) && Boolean(secretAccessKey) && Boolean(bucketName);

let client: S3Client | null = null;

export function getR2Client() {
  if (!isR2Enabled || !accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("R2 storage is not configured. Missing env vars.");
  }
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }
  return { client, bucket: bucketName };
}
