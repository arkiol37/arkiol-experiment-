// src/lib/s3.ts
// Safe S3 client — only operates when AWS credentials are configured.
// Framework-neutral: also imported by apps/render-backend at runtime.
import { detectCapabilities } from '@arkiol/shared';

function getS3Client() {
  const env = process.env;
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId:     env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

function getBucket(): string { return process.env.S3_BUCKET_NAME!; }
function getCdnDomain(): string { return process.env.CLOUDFRONT_DOMAIN ?? ''; }

export async function uploadToS3(
  key: string, body: Buffer, contentType: string, metadata?: Record<string, string>
): Promise<string> {
  if (!detectCapabilities().storage) throw new Error('Storage not configured');
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const bucket = getBucket();
  const cdn    = getCdnDomain();
  await getS3Client().send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: body,
    ContentType: contentType, Metadata: metadata, ServerSideEncryption: 'AES256',
  }));
  if (cdn) return `${cdn}/${key}`;
  return `https://${bucket}.s3.${process.env.AWS_REGION ?? 'us-east-1'}.amazonaws.com/${key}`;
}

export async function getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  if (!detectCapabilities().storage) throw new Error('Storage not configured');
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: getBucket(), Key: key }), { expiresIn });
}

export async function deleteFromS3(key: string): Promise<void> {
  if (!detectCapabilities().storage) return;
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await getS3Client().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

export async function s3ObjectExists(key: string): Promise<boolean> {
  if (!detectCapabilities().storage) return false;
  try {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    await getS3Client().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return true;
  } catch { return false; }
}

export function buildS3Key(orgId: string, assetId: string, ext: string): string {
  const shard = assetId.slice(0, 2);
  return `orgs/${orgId}/assets/${shard}/${assetId}.${ext}`;
}
