import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { disconnectPrisma, getPrismaClient } from '../db/prisma';
import { env } from '../config/env';

async function downloadBinary(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function assertPublicBaseUrl(): string {
  const base = env.PUBLIC_BASE_URL.trim();
  if (!base) {
    throw new Error('PUBLIC_BASE_URL is required to cache exercise media locally');
  }
  return base.replace(/\/$/, '');
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const publicBaseUrl = assertPublicBaseUrl();
  const mediaDir = path.join(process.cwd(), 'exercise-media');

  await mkdir(mediaDir, { recursive: true });

  const rows = await prisma.exerciseMedia.findMany({
    where: {
      OR: [{ gifUrl: { not: null } }, { videoUrl: { not: null } }]
    }
  });

  let updated = 0;

  for (const row of rows) {
    const updates: { gifUrl?: string; videoUrl?: string } = {};

    if (row.gifUrl && !row.gifUrl.includes('/media/exercises/')) {
      const gifBuffer = await downloadBinary(row.gifUrl);
      const gifName = `${row.normalizedName.replace(/\s+/g, '-')}.gif`;
      await writeFile(path.join(mediaDir, gifName), gifBuffer);
      updates.gifUrl = `${publicBaseUrl}/media/exercises/${gifName}`;
    }

    if (row.videoUrl && !row.videoUrl.includes('/media/exercises/')) {
      const videoBuffer = await downloadBinary(row.videoUrl);
      const videoName = `${row.normalizedName.replace(/\s+/g, '-')}.mp4`;
      await writeFile(path.join(mediaDir, videoName), videoBuffer);
      updates.videoUrl = `${publicBaseUrl}/media/exercises/${videoName}`;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.exerciseMedia.update({
        where: { id: row.id },
        data: updates
      });
      updated += 1;
    }
  }

  console.log(`Cached media for ${updated} exercise records.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
