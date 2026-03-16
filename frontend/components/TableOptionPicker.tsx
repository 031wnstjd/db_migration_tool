'use client';

import { useMemo, useState } from 'react';

type Props = {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
  searchPlaceholder?: string;
  emptyLabel?: string;
  largeThreshold?: number;
  renderLimit?: number;
};

export default function TableOptionPicker({
  label,
  value,
  options,
  disabled,
  onChange,
  searchPlaceholder = '테이블명 검색',
  emptyLabel = '선택',
  largeThreshold = 80,
  renderLimit = 120,
}: Props) {
  const [query, setQuery] = useState(value || '');

  const normalizeForSearch = (text: string) => text.trim().toLocaleLowerCase();
  const normalizedQuery = normalizeForSearch(query);
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) {
      return options.slice(0, renderLimit);
    }

    return options.filter((option) => normalizeForSearch(option).includes(normalizedQuery)).slice(0, renderLimit);
  }, [normalizedQuery, options, renderLimit]);

  const isLargeList = options.length > largeThreshold;

  if (!isLargeList) {
    return (
      <label>
        <span className="label">{label}</span>
        <select className="select" value={value && options.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">{emptyLabel}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="table-picker">
      <div className="table-picker-header">
        <span className="label">{label}</span>
        <span className="helper">총 {options.length}개</span>
      </div>
      <input
        className="input"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        disabled={disabled}
        placeholder={searchPlaceholder}
        autoComplete="off"
      />
      <p className="helper">대소문자 구분 없이 검색됩니다.</p>
      <div className="table-picker-results" role="listbox" aria-label={label}>
        {filteredOptions.length > 0 ? (
          filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={`table-picker-option ${value === option ? 'active' : ''}`}
              onClick={() => {
                setQuery(option);
                onChange(option);
              }}
              disabled={disabled}
            >
              {option}
            </button>
          ))
        ) : (
          <p className="helper">검색 결과가 없습니다.</p>
        )}
      </div>
      {normalizedQuery && options.length > filteredOptions.length ? (
        <p className="helper">검색 결과가 많아 상위 {filteredOptions.length}개만 표시합니다. 검색어를 더 구체적으로 입력하세요.</p>
      ) : null}
    </div>
  );
}
