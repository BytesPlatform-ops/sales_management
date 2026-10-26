import { ProjectsProvider } from '@/components/projects/ui';

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <ProjectsProvider>{children}</ProjectsProvider>;
}
