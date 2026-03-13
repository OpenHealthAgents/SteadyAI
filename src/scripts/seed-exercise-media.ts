import { disconnectPrisma, getPrismaClient } from '../db/prisma';
import { normalizeExerciseName } from '../services/exercise-media.service';

const DEFAULT_EXERCISE_MEDIA = [
  {
    displayName: 'March in Place',
    thumbnailLabel: 'March in Place',
    demoUrl: 'https://www.youtube.com/results?search_query=march+in+place+exercise'
  },
  {
    displayName: 'Jumping Jacks',
    thumbnailLabel: 'Jumping Jacks',
    demoUrl: 'https://www.youtube.com/results?search_query=jumping+jacks+exercise'
  },
  {
    displayName: 'Bodyweight Box Squat',
    thumbnailLabel: 'Box Squat',
    demoUrl: 'https://www.youtube.com/results?search_query=box+squat+bodyweight+exercise'
  },
  {
    displayName: 'Bodyweight Squat',
    thumbnailLabel: 'Bodyweight Squat',
    demoUrl: 'https://www.youtube.com/results?search_query=bodyweight+squat+exercise'
  },
  {
    displayName: 'Push-Up + Shoulder Tap',
    thumbnailLabel: 'Push-Up + Shoulder Tap',
    demoUrl: 'https://www.youtube.com/results?search_query=push+up+shoulder+tap+exercise'
  },
  {
    displayName: 'Push-Up',
    thumbnailLabel: 'Push-Up',
    demoUrl: 'https://www.youtube.com/results?search_query=push+up+exercise'
  },
  {
    displayName: 'Glute Bridge',
    thumbnailLabel: 'Glute Bridge',
    demoUrl: 'https://www.youtube.com/results?search_query=glute+bridge+exercise'
  },
  {
    displayName: 'Reverse Lunge',
    thumbnailLabel: 'Reverse Lunge',
    demoUrl: 'https://www.youtube.com/results?search_query=reverse+lunge+exercise'
  },
  {
    displayName: 'Forearm Plank',
    thumbnailLabel: 'Forearm Plank',
    demoUrl: 'https://www.youtube.com/results?search_query=forearm+plank+exercise'
  },
  {
    displayName: 'Mountain Climbers',
    thumbnailLabel: 'Mountain Climbers',
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
        demoUrl: entry.demoUrl
      },
      create: {
        normalizedName: normalizeExerciseName(entry.displayName),
        displayName: entry.displayName,
        thumbnailLabel: entry.thumbnailLabel,
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
