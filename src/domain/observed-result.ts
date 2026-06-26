export interface ObservedResult<T> {
  readonly value: T | null;
  readonly error: Error | null;
  readonly isFetching: boolean;
}

export type ObservedResultListener<T> = (result: ObservedResult<T>) => void;

export function observedValue<T>(result: ObservedResult<T>): T | null {
  return result.value;
}

export function observedInitialLoading<T>(result: ObservedResult<T>, currentValue: T | null | undefined): boolean {
  return currentValue == null && result.isFetching;
}

export function observedInitialError<T>(result: ObservedResult<T>, currentValue: T | null | undefined): Error | null {
  return currentValue == null ? result.error : null;
}
