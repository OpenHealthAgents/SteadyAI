import { disconnectPrisma, getPrismaClient } from '../db/prisma';
import { normalizeExerciseName } from '../services/exercise-media.service';

function toGiphyVideoUrl(gifUrl: string): string {
  return gifUrl.replace(/\/giphy\.gif$/i, '/giphy.mp4');
}

const DEFAULT_EXERCISE_MEDIA = [
  {
    displayName: 'March in Place',
    thumbnailLabel: 'March in Place',
    gifUrl: 'https://media.giphy.com/media/l0MYDGA3Du1hBR4xG/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/l0MYDGA3Du1hBR4xG/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=march+in+place+exercise'
  },
  {
    displayName: 'Jumping Jacks',
    thumbnailLabel: 'Jumping Jacks',
    gifUrl: 'https://media.giphy.com/media/3o7TKtnuHOHHUjR38Y/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/3o7TKtnuHOHHUjR38Y/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=jumping+jacks+exercise'
  },
  {
    displayName: 'Bodyweight Box Squat',
    thumbnailLabel: 'Box Squat',
    gifUrl: 'https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=box+squat+bodyweight+exercise'
  },
  {
    displayName: 'Bodyweight Squat',
    thumbnailLabel: 'Bodyweight Squat',
    gifUrl: 'https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=bodyweight+squat+exercise'
  },
  {
    displayName: 'Push-Up + Shoulder Tap',
    thumbnailLabel: 'Push-Up + Shoulder Tap',
    gifUrl: 'https://media.giphy.com/media/xT0Gqz4x4eLd5gDtaU/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/xT0Gqz4x4eLd5gDtaU/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=push+up+shoulder+tap+exercise'
  },
  {
    displayName: 'Push-Up',
    thumbnailLabel: 'Push-Up',
    gifUrl: 'https://media.giphy.com/media/xT0Gqz4x4eLd5gDtaU/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/xT0Gqz4x4eLd5gDtaU/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=push+up+exercise'
  },
  {
    displayName: 'Glute Bridge',
    thumbnailLabel: 'Glute Bridge',
    gifUrl: 'https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=glute+bridge+exercise'
  },
  {
    displayName: 'Reverse Lunge',
    thumbnailLabel: 'Reverse Lunge',
    gifUrl: 'https://media.giphy.com/media/l0HlNQ03J5JxX6lva/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/l0HlNQ03J5JxX6lva/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=reverse+lunge+exercise'
  },
  {
    displayName: 'Forearm Plank',
    thumbnailLabel: 'Forearm Plank',
    gifUrl: 'https://media.giphy.com/media/26FPJGjhefSJuaRhu/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/26FPJGjhefSJuaRhu/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=forearm+plank+exercise'
  },
  {
    displayName: 'Mountain Climbers',
    thumbnailLabel: 'Mountain Climbers',
    gifUrl: 'https://media.giphy.com/media/3o6ZsVx5YQfFQ8kBHy/giphy.gif',
    videoUrl: toGiphyVideoUrl('https://media.giphy.com/media/3o6ZsVx5YQfFQ8kBHy/giphy.gif'),
    demoUrl: 'https://www.youtube.com/results?search_query=mountain+climbers+exercise'
  }
] as const;

async function main(): Promise<void> {
  const prisma = getPrismaClient();

  for (const entry of DEFAULT_EXERCISE_MEDIA) {
    await prisma.exerciseMedia.upsert({
      where: {
        normalizedName: normalizeExerciseName(entry.displayName)
      },
      update: {
        displayName: entry.displayName,
        thumbnailLabel: entry.thumbnailLabel,
        gifUrl: entry.gifUrl,
        videoUrl: entry.videoUrl,
        demoUrl: entry.demoUrl
      },
      create: {
        normalizedName: normalizeExerciseName(entry.displayName),
        displayName: entry.displayName,
        thumbnailLabel: entry.thumbnailLabel,
        gifUrl: entry.gifUrl,
        videoUrl: entry.videoUrl,
        demoUrl: entry.demoUrl
      }
    });
  }

  console.log(`Seeded ${DEFAULT_EXERCISE_MEDIA.length} exercise media records.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
