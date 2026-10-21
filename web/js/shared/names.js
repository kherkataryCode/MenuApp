// Funny table names: adjective + Indian snack, unique within a table.
export const NAME_ADJ = ['Hangry', 'Sleepy', 'Spicy', 'Crispy', 'Saucy', 'Chaotic', 'Cheesy', 'Turbo', 'Sneaky', 'Buttery', 'Dancing', 'Grumpy', 'Sassy', 'Midnight', 'Captain', 'Professor', 'Tiny', 'Mega', 'Fancy', 'Lazy', 'Extra', 'Royal', 'Jumbo', 'Wobbly', 'Desi', 'Filmy', 'Bindaas', 'Garam', 'Thanda', 'Dramatic'];
export const NAME_FOOD = [['Samosa', '🥟'], ['Paneer', '🧀'], ['Vada Pav', '🍔'], ['Jalebi', '🍥'], ['Momo', '🥟'], ['Pakora', '🍤'], ['Naan', '🫓'], ['Dosa', '🫓'], ['Biryani', '🍛'], ['Chutney', '🫙'], ['Kulfi', '🍦'], ['Gulab Jamun', '🟤'], ['Panipuri', '🫧'], ['Lassi', '🥛'], ['Tikka', '🍢'], ['Pickle', '🥒'], ['Papad', '🍘'], ['Chai', '☕'], ['Rasgulla', '⚪'], ['Ladoo', '🟠'], ['Pav Bhaji', '🍞'], ['Dhokla', '🟨'], ['Kachori', '🥮'], ['Chole', '🫘'], ['Rajma', '🫘'], ['Poha', '🍚'], ['Masala Fries', '🍟'], ['Mango', '🥭']];
export const NICK_COLORS = ['#FF4D8D', '#3E7BFA', '#18A86B', '#FF8A00', '#8E44EC', '#E53935', '#00A3C4', '#C2185B'];
export function funnyName(taken, rand = Math.random) {
  const t = new Set(taken || []); const pick = a => a[Math.floor(rand() * a.length)];
  for (let k = 0; k < 80; k++) { const adj = pick(NAME_ADJ), [food, emoji] = pick(NAME_FOOD); const nick = `${adj} ${food}`; if (!t.has(nick)) return { nick, emoji }; }
  const [food, emoji] = pick(NAME_FOOD); return { nick: `Mystery ${food} ${Math.floor(rand() * 900 + 100)}`, emoji };
}
export const nickColor = nick => NICK_COLORS[Math.abs([...(nick || '')].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)) % NICK_COLORS.length];
