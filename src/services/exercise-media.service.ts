import { getPrismaClient } from '../db/prisma';

type ExerciseMediaTarget = {
  name: string;
  thumbnailLabel?: string;
  gifUrl?: string;
  videoUrl?: string;
  demoUrl?: string;
};

export function normalizeExerciseName(name: string): string {
  return name.toLowerCase().replace(/^finisher:\s*/i, '').replace(/\s+/g, ' ').trim();
}

export async function attachExerciseMedia<T extends ExerciseMediaTarget>(exercises: T[]): Promise<T[]> {
  const normalizedNames = Array.from(
    new Set(
      exercises
        .map((exercise) => normalizeExerciseName(exercise.name))
        .filter((value) => value.length > 0)
    )
  );

  if (normalizedNames.length === 0) {
    return exercises;
  }

  const prisma = getPrismaClient();
  const rows = await prisma.exerciseMedia.findMany({
    where: {
      normalizedName: {
        in: normalizedNames
      }
    }
  });

  const byName = new Map(rows.map((row) => [row.normalizedName, row]));

  return exercises.map((exercise) => {
    const match = byName.get(normalizeExerciseName(exercise.name));
    if (!match) {
      return {
        ...exercise,
        thumbnailLabel: exercise.thumbnailLabel ?? exercise.name
      };
    }

    return {
      ...exercise,
      thumbnailLabel: match.thumbnailLabel ?? match.displayName ?? exercise.thumbnailLabel ?? exercise.name,
      gifUrl: match.gifUrl ?? exercise.gifUrl,
      videoUrl: match.videoUrl ?? exercise.videoUrl,
      demoUrl: match.demoUrl ?? exercise.demoUrl
    };
  });
}
