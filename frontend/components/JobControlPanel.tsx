'use client';

type Props = {
  inFlight?: boolean;
  onRunDry: () => void;
  onRunReal: () => void;
  onRefreshList?: () => void;
  onCancel?: () => void;
  canCancel?: boolean;
  cancelInFlight?: boolean;
};

export default function JobControlPanel({ inFlight, onRunDry, onRunReal, onRefreshList, onCancel, canCancel, cancelInFlight }: Props) {
  return (
    <section className="card panel">
      <h3 className="card-title">실행</h3>
      <div className="flex-gap">
        <button className="btn primary" type="button" onClick={onRunDry} disabled={inFlight}>
          {inFlight ? '시작 중...' : 'Dry Run 실행'}
        </button>
        <button className="btn" type="button" onClick={onRunReal} disabled={inFlight}>
          실제 마이그레이션 실행
        </button>
      </div>
      <div className="flex-gap">
        <button
          className="btn"
          type="button"
          onClick={onCancel}
          disabled={!canCancel || cancelInFlight}
        >
          {cancelInFlight ? '취소 중…' : '작업 취소'}
        </button>
      </div>
      <button className="btn" type="button" onClick={onRefreshList}>
        최근 Job 목록 새로고침
      </button>
    </section>
  );
}
