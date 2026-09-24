/**
 * AddSectionModal.jsx
 * Form to manually add a single section with all required + optional fields.
 */
import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

const REQUIRED_FIELDS = [
  { key: 'id',       label: 'ID',        type: 'text',   placeholder: 'e.g., 1L' },
  { key: 'district', label: 'District',  type: 'text',   placeholder: 'e.g., 02 - FORT WORTH' },
  { key: 'highway',  label: 'Highway',   type: 'text',   placeholder: 'e.g., IH 0020 L' },
  { key: 'beginRef', label: 'Begin Ref', type: 'number', placeholder: '120.500' },
  { key: 'endRef',   label: 'End Ref',   type: 'number', placeholder: '125.200' },
];

const OPTIONAL_FIELDS = [
  { key: 'sn',              label: 'S/N',            type: 'text',   placeholder: '1' },
  { key: 'yearConstructed', label: 'Year Constructed',type: 'number', placeholder: '1998' },
  { key: 'endOfLife',       label: 'End of Life',     type: 'number', placeholder: '2018' },
  { key: 'serviceLife',     label: 'Service Life',    type: 'number', placeholder: '20' },
  { key: 'rehabMethod',     label: 'Rehab Method',    type: 'text',   placeholder: 'Reconstruction' },
  { key: 'countyName',      label: 'County Name',     type: 'text',   placeholder: 'TARRANT' },
  { key: 'oldSlabTh',       label: 'Old Slab Th',     type: 'number', placeholder: '' },
  { key: 'slabTh',          label: 'Slab Th',         type: 'number', placeholder: '' },
  { key: 'base',            label: 'Base',            type: 'text',   placeholder: '' },
  { key: 'baseTh',          label: 'Base Th',         type: 'number', placeholder: '' },
  { key: 'sub',             label: 'Sub',             type: 'text',   placeholder: '' },
];

export default function AddSectionModal({ onAdd, onCancel, existingIds = new Set() }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  }

  function validate() {
    const errs = {};
    for (const f of REQUIRED_FIELDS) {
      const v = form[f.key]?.trim?.() ?? form[f.key];
      if (!v && v !== 0) errs[f.key] = 'Required';
    }
    if (existingIds.has(form.id?.trim())) {
      errs.id = 'This ID already exists in the project';
    }
    const begin = parseFloat(form.beginRef);
    const end   = parseFloat(form.endRef);
    if (!isNaN(begin) && !isNaN(end) && end <= begin) {
      errs.endRef = 'End Ref must be greater than Begin Ref';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    const section = {
      _uuid: uuidv4(),
      id:              form.id?.trim(),
      sn:              form.sn?.trim() || null,
      district:        form.district?.trim(),
      highway:         form.highway?.trim(),
      beginRef:        parseFloat(form.beginRef),
      endRef:          parseFloat(form.endRef),
      yearConstructed: form.yearConstructed ? parseInt(form.yearConstructed, 10) : null,
      endOfLife:       form.endOfLife       ? parseInt(form.endOfLife, 10)       : null,
      serviceLife:     form.serviceLife     ? parseInt(form.serviceLife, 10)     : null,
      rehabMethod:     form.rehabMethod?.trim() || null,
      countyName:      form.countyName?.trim()  || null,
      oldSlabTh:       form.oldSlabTh  ? parseFloat(form.oldSlabTh)  : null,
      slabTh:          form.slabTh     ? parseFloat(form.slabTh)     : null,
      base:            form.base?.trim()   || null,
      baseTh:          form.baseTh     ? parseFloat(form.baseTh)     : null,
      sub:             form.sub?.trim()    || null,
      columnMappings:  {},
      extraColumns:    {},
    };

    onAdd(section);
  }

  function renderField(field) {
    return (
      <div className="form-group" key={field.key}>
        <label className="form-label" htmlFor={`add-sec-${field.key}`}>
          {field.label}
        </label>
        <input
          id={`add-sec-${field.key}`}
          className={`form-input${errors[field.key] ? ' form-input--error' : ''}`}
          type={field.type}
          placeholder={field.placeholder}
          value={form[field.key] ?? ''}
          onChange={e => set(field.key, e.target.value)}
          step={field.type === 'number' ? 'any' : undefined}
        />
        {errors[field.key] && <div className="form-error">{errors[field.key]}</div>}
      </div>
    );
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Add Section"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="modal modal--md">
        <div className="modal__header">
          <div>
            <div className="modal__title">Add Section</div>
            <div className="modal__subtitle">Enter section details manually</div>
          </div>
          <button className="modal__close" onClick={onCancel} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            <div style={{ fontWeight: 600, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--accent-primary)', marginBottom: 12 }}>
              Required Fields
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              {REQUIRED_FIELDS.map(f => renderField(f))}
            </div>

            <div className="divider" />

            <div style={{ fontWeight: 600, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 12 }}>
              Optional Fields
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              {OPTIONAL_FIELDS.map(f => renderField(f))}
            </div>
          </div>

          <div className="modal__footer">
            <button id="btn-cancel-add-section" type="button" className="btn btn--ghost" onClick={onCancel}>
              Cancel
            </button>
            <button id="btn-confirm-add-section" type="submit" className="btn btn--primary">
              Add Section
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
