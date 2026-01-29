import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';

interface SalaryProgressProps {
  earned: number;
  potential: number;
  projected: number;
  daysElapsed: number;
  totalDays: number;
}

export function SalaryProgress({
  earned,
  potential,
  projected,
  daysElapsed,
  totalDays,
}: SalaryProgressProps) {
  const progressPercent = Math.min((earned / potential) * 100, 100);
  const projectedPercent = Math.min((projected / potential) * 100, 100);
  const daysPercent = (daysElapsed / totalDays) * 100;

  return (
    <div className="bg-white rounded-xl p-6 border shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        💰 Salary Progress
      </h3>

      {/* Main Progress Bar */}
      <div className="relative h-8 bg-gray-100 rounded-full overflow-hidden mb-4">
        {/* Projected (lighter) */}
        <div
          className="absolute h-full bg-primary-200 transition-all duration-500"
          style={{ width: `${projectedPercent}%` }}
        />
        {/* Earned (darker) */}
        <div
          className="absolute h-full bg-primary-500 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
        {/* Current day marker */}
        <div
          className="absolute h-full w-0.5 bg-gray-400"
          style={{ left: `${daysPercent}%` }}
        />
      </div>

      {/* Legend */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold text-primary-600">
            {formatCurrency(earned)}
          </p>
          <p className="text-sm text-gray-500">Earned So Far</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-primary-400">
            {formatCurrency(projected)}
          </p>
          <p className="text-sm text-gray-500">Projected</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-400">
            {formatCurrency(potential)}
          </p>
          <p className="text-sm text-gray-500">Base Salary</p>
        </div>
      </div>

      {/* Days Info */}
      <div className="mt-4 pt-4 border-t">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Working Days</span>
          <span className="font-medium">
            {daysElapsed} / {totalDays} days
          </span>
        </div>
      </div>
    </div>
  );
}
