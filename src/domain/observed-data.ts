export interface ObservedDataResult<T> {
  readonly data: T | null;
  readonly error: Error | null;
  readonly isFetching: boolean;
}

export type ObservedDataListener<T> = (result: ObservedDataResult<T>) => void;

export function observedData<T>(result: ObservedDataResult<T>): T | null {
  return result.data;
}

export function observedInitialLoading<T>(result: ObservedDataResult<T>, currentData: T | null | undefined): boolean {
  return currentData == null && result.isFetching;
}

export function observedInitialError<T>(result: ObservedDataResult<T>, currentData: T | null | undefined): Error | null {
  return currentData == null ? result.error : null;
}
