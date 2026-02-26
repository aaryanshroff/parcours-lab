export type Course = {
  id: string;
  title: string;
  status: "accepted" | "rejected";
};

export const COURSES: Course[] = [
  { id: "c1", title: "Intro to Data Science", status: "accepted" },
  { id: "c2", title: "UX Research Fundamentals", status: "rejected" },
];