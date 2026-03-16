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
      <div className="section-block-header compact">
        <div>
          <p className="section-kicker">Execution</p>
          <h3 className="card-title">실행 제어</h3>
        </div>
      </div>

      <div className="job-action-groups">
        <div className="action-group">
          <p className="label">실행</p>
          <div className="action-row stretch">
            <button className="btn primary" type="button" onClick={onRunDry} disabled={inFlight}>
              {inFlight ? '시작 중...' : 'Dry Run 실행'}
            </button>
            <button className="btn" type="button" onClick={onRunReal} disabled={inFlight}>
              실제 마이그레이션 실행
            </button>
          </div>
        </div>

        <div className="action-group action-group-muted">
          <p className="label">보조 작업</p>
          <div className="action-row stretch">
            <button className="btn" type="button" onClick={onRefreshList}>
              최근 Job 목록 새로고침
            </button>
            <button className="btn" type="button" onClick={onCancel} disabled={!canCancel || cancelInFlight}>
              {cancelInFlight ? '취소 중…' : '작업 취소'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
