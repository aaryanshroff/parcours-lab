export type RecommendedCourse = {
  id?: string;
  title?: string;
  provider?: string;
  url?: string;
  summary?: string;
  level?: string;
  language?: string;
  explanation?: string;
  format?: string;
  duration_hours?: number | null;
  price?: string;
  rating?: number | null;
  certificate?: boolean;
  skills?: Array<{
    name: string;
    esco_uri?: string;
    description?: string;
  }>;
};

export type SkillNode = {
  id: string;
  name: string;
  description: string;
  why: string;
  level: string;
  depends_on: string[];
  course: RecommendedCourse | null;
};

export type SkillRoadmap = {
  skills: SkillNode[];
};

export type ChatResponse = {
  response: string;
  skill_roadmap?: SkillRoadmap;
  error?: string;
};
