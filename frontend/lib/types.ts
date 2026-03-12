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

export type ChatResponse = {
  response: string;
  recommended_courses?: RecommendedCourse[];
  error?: string;
};
