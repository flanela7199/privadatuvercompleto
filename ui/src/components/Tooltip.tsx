import React from 'react';

/** Small "?" bubble that explains a setting on hover. */
export const Tooltip = ({ text }: { text: string }) => <i className="tip" title={text}>?</i>;
