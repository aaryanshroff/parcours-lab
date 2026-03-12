export type RecommendedCourse = {
  id?: string;
  title?: string;
  provider?: string;
  url?: string;
  summary?: string;
  level?: string;
  language?: string;
};

export type ProfileUpdate = {
  field: "goal" | "current_skills" | "required_skills";
  action: "add" | "remove" | "set";
  value: string | string[];
  previous_value: string | string[];
};

export type ChatResponse = {
  response: string;
  recommended_courses?: RecommendedCourse[];
  profile_updates?: ProfileUpdate[];
  error?: string;
};
