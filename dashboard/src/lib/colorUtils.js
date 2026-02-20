/**
 * Utility to generate deterministic colors for product labels.
 * 
 * We use a hash of the UUID or ID string to select a color from a predefined palette.
 * This ensures that the same product always gets the same color,
 * without needing to store the color in the database.
 */

const PALETTE = [
    { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200' },
    { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200' },
    { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200' },
    { bg: 'bg-sky-100', text: 'text-sky-800', border: 'border-sky-200' },
    { bg: 'bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-200' },
    { bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-200' },
    { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200' },
    { bg: 'bg-lime-100', text: 'text-lime-800', border: 'border-lime-200' },
    { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200' },
    { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' },
    { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200' },
    { bg: 'bg-pink-100', text: 'text-pink-800', border: 'border-pink-200' },
    { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800', border: 'border-fuchsia-200' },
    { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-200' },
];

/**
 * Returns a Tailwind class string for a product pill.
 * @param {string} productId - The UUID or ID of the product.
 * @returns {string} - Combined class string for bg, text, and border.
 */
export const getProductColor = (productId) => {
    if (!productId) {
        // Default/Generic color
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }

    // Simple hash function to get a number from the string
    let hash = 0;
    for (let i = 0; i < productId.length; i++) {
        hash = productId.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Use absolute value of hash to select from palette
    const index = Math.abs(hash) % PALETTE.length;
    const color = PALETTE[index];

    return `${color.bg} ${color.text} border ${color.border}`;
};
