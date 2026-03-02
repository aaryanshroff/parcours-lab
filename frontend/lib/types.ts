export type RecommendedCourse = {
  id?: string;
  title?: string;
  provider?: string;
  url?: string;
  summary?: string;
  level?: string;
  language?: string;
};

export type ChatResponse = {
  response: string;
  recommended_courses?: RecommendedCourse[];
  error?: string;
};
