import { TrainingNav } from '@/components/training/rep/nav';

export default function RepTrainingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-6xl mx-auto">
      <TrainingNav />
      {children}
    </div>
  );
}
