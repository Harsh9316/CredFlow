// Indian currency shorthand used in explanation strings.
export const lakh = (amount: number) => `₹${(amount / 100000).toFixed(1)}L`
export const crore = (amount: number) => `₹${(amount / 10000000).toFixed(2)} Cr`
