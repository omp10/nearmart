/**
 * The demo catalogue `npm run seed:demo` loads: a believable shop for each
 * module, so the customer app and the panel have something real to show.
 * Prices are in rupees here and converted to paise by the seed script.
 *
 * Variant: [label, unit, unitQty, price, offerPrice|null, stock]
 */

const v = (label, unit, unitQty, price, offer, stock) => ({ label, unit, unitQty, price, offer, stock });

export const MODULE_THEME = {
    grocery: { icon: 'basket', colors: ['#16a34a', '#065f46'] },
    produce: { icon: 'leaf', colors: ['#65a30d', '#166534'] },
    electronics: { icon: 'bolt', colors: ['#2563eb', '#1e1b4b'] },
    laundry: { icon: 'shirt', colors: ['#0891b2', '#1e3a8a'] }
};

/** Categories: name, colour pair for artwork, subcategories, products (in the subcategory, or the category when it has none). */
export const CATALOG = {
    grocery: [
        {
            name: 'Staples',
            colors: ['#f59e0b', '#b45309'],
            children: [
                {
                    name: 'Atta & Flours',
                    products: [
                        { name: 'Aashirvaad Whole Wheat Atta', brand: 'Aashirvaad', featured: true, variants: [v('1 kg', 'kg', 1, 68, 62, 120), v('5 kg', 'kg', 5, 295, 269, 80), v('10 kg', 'kg', 10, 560, 515, 40)] },
                        { name: 'Besan (Gram Flour)', brand: 'Tata Sampann', variants: [v('500 g', 'g', 500, 72, null, 60), v('1 kg', 'kg', 1, 138, 129, 40)] },
                        { name: 'Fine Sooji (Rava)', brand: 'Rajdhani', variants: [v('500 g', 'g', 500, 38, 35, 70)] }
                    ]
                },
                {
                    name: 'Rice',
                    products: [
                        { name: 'India Gate Basmati Rice Classic', brand: 'India Gate', featured: true, variants: [v('1 kg', 'kg', 1, 199, 179, 90), v('5 kg', 'kg', 5, 945, 849, 35)] },
                        { name: 'Sona Masoori Raw Rice', brand: 'Daawat', variants: [v('5 kg', 'kg', 5, 420, 389, 50), v('10 kg', 'kg', 10, 810, 749, 25)] },
                        { name: 'Poha (Thick)', brand: 'Tata Sampann', variants: [v('500 g', 'g', 500, 45, null, 80)] }
                    ]
                },
                {
                    name: 'Dals & Pulses',
                    products: [
                        { name: 'Toor Dal (Unpolished)', brand: 'Tata Sampann', variants: [v('500 g', 'g', 500, 95, 89, 100), v('1 kg', 'kg', 1, 182, 169, 70)] },
                        { name: 'Moong Dal Yellow', brand: 'Fortune', variants: [v('500 g', 'g', 500, 78, null, 90)] },
                        { name: 'Kabuli Chana', brand: 'Tata Sampann', variants: [v('500 g', 'g', 500, 89, 82, 60)] }
                    ]
                }
            ]
        },
        {
            name: 'Oils & Ghee',
            colors: ['#eab308', '#a16207'],
            products: [
                { name: 'Fortune Sunflower Oil', brand: 'Fortune', featured: true, variants: [v('1 L', 'l', 1, 165, 149, 80), v('5 L', 'l', 5, 799, 729, 30)] },
                { name: 'Amul Pure Ghee', brand: 'Amul', variants: [v('500 ml', 'ml', 500, 330, 315, 50), v('1 L', 'l', 1, 645, 619, 30)] },
                { name: 'Kachi Ghani Mustard Oil', brand: 'Patanjali', variants: [v('1 L', 'l', 1, 185, 169, 60)] }
            ]
        },
        {
            name: 'Snacks & Biscuits',
            colors: ['#f97316', '#c2410c'],
            products: [
                { name: 'Haldiram Aloo Bhujia', brand: "Haldiram's", variants: [v('200 g', 'g', 200, 55, 50, 120), v('400 g', 'g', 400, 105, 95, 60)] },
                { name: 'Parle-G Gold Biscuits', brand: 'Parle', variants: [v('1 kg pack', 'pack', 1, 150, 138, 80)] },
                { name: 'Lay’s Classic Salted Chips', brand: 'Lay’s', variants: [v('90 g', 'g', 90, 50, null, 150)] },
                { name: 'Britannia Good Day Cashew', brand: 'Britannia', variants: [v('600 g', 'g', 600, 120, 108, 70)] }
            ]
        },
        {
            name: 'Beverages',
            colors: ['#a855f7', '#6b21a8'],
            children: [
                {
                    name: 'Tea & Coffee',
                    products: [
                        { name: 'Tata Tea Gold', brand: 'Tata Tea', featured: true, variants: [v('250 g', 'g', 250, 165, 150, 90), v('500 g', 'g', 500, 320, 289, 50)] },
                        { name: 'Nescafé Classic Instant Coffee', brand: 'Nescafé', variants: [v('100 g jar', 'g', 100, 330, 309, 40)] }
                    ]
                },
                {
                    name: 'Juices & Drinks',
                    products: [
                        { name: 'Real Fruit Power Mixed Fruit', brand: 'Real', variants: [v('1 L', 'l', 1, 125, 110, 60)] },
                        { name: 'Paper Boat Aam Panna', brand: 'Paper Boat', variants: [v('250 ml', 'ml', 250, 40, null, 100)] }
                    ]
                }
            ]
        },
        {
            name: 'Dairy & Breakfast',
            colors: ['#0ea5e9', '#0369a1'],
            products: [
                { name: 'Amul Taaza Toned Milk', brand: 'Amul', variants: [v('500 ml', 'ml', 500, 28, null, 200), v('1 L', 'l', 1, 56, null, 150)], handlingNote: 'Kept chilled; delivered in an insulated bag.' },
                { name: 'Amul Butter', brand: 'Amul', variants: [v('100 g', 'g', 100, 58, null, 90), v('500 g', 'g', 500, 280, 268, 40)] },
                { name: 'Kellogg’s Corn Flakes Original', brand: 'Kellogg’s', variants: [v('475 g', 'g', 475, 210, 189, 50)] },
                { name: 'Farm Fresh Brown Eggs', brand: 'Nearmart Farms', variants: [v('6 pcs', 'piece', 6, 72, 66, 80), v('12 pcs', 'dozen', 1, 138, 125, 60)] }
            ]
        },
        {
            name: 'Masalas & Spices',
            colors: ['#ef4444', '#991b1b'],
            products: [
                { name: 'Everest Garam Masala', brand: 'Everest', variants: [v('100 g', 'g', 100, 92, 85, 70)] },
                { name: 'MDH Kitchen King Masala', brand: 'MDH', variants: [v('100 g', 'g', 100, 88, null, 70)] },
                { name: 'Tata Salt Iodised', brand: 'Tata', variants: [v('1 kg', 'kg', 1, 28, null, 200)] }
            ]
        }
    ],

    produce: [
        {
            name: 'Fresh Vegetables',
            colors: ['#22c55e', '#15803d'],
            children: [
                {
                    name: 'Everyday Vegetables',
                    products: [
                        { name: 'Onion', featured: true, variants: [v('1 kg', 'kg', 1, 45, 39, 300), v('2 kg', 'kg', 2, 88, 75, 150)] },
                        { name: 'Potato', featured: true, variants: [v('1 kg', 'kg', 1, 38, 34, 300), v('2 kg', 'kg', 2, 74, 65, 150)] },
                        { name: 'Tomato (Hybrid)', variants: [v('500 g', 'g', 500, 25, 22, 200), v('1 kg', 'kg', 1, 48, 42, 150)] },
                        { name: 'Lady Finger (Bhindi)', variants: [v('250 g', 'g', 250, 22, null, 120)] },
                        { name: 'Cauliflower', variants: [v('1 piece (approx. 600 g)', 'piece', 1, 45, 40, 80)] }
                    ]
                },
                {
                    name: 'Leafy Greens',
                    products: [
                        { name: 'Palak (Spinach)', variants: [v('1 bunch', 'bunch', 1, 25, 20, 100)] },
                        { name: 'Methi (Fenugreek)', variants: [v('1 bunch', 'bunch', 1, 20, null, 100)] }
                    ]
                },
                {
                    name: 'Herbs & Seasonings',
                    products: [
                        { name: 'Coriander Leaves', variants: [v('1 bunch', 'bunch', 1, 15, 12, 150)] },
                        { name: 'Green Chilli', variants: [v('100 g', 'g', 100, 12, null, 150)] },
                        { name: 'Ginger', variants: [v('250 g', 'g', 250, 35, 30, 100)] }
                    ]
                }
            ]
        },
        {
            name: 'Fresh Fruits',
            colors: ['#f43f5e', '#be123c'],
            children: [
                {
                    name: 'Seasonal Fruits',
                    products: [
                        { name: 'Banana Robusta', featured: true, variants: [v('6 pcs', 'piece', 6, 42, 36, 150), v('1 dozen', 'dozen', 1, 78, 69, 100)] },
                        { name: 'Shimla Apple', variants: [v('1 kg', 'kg', 1, 180, 159, 80)] },
                        { name: 'Pomegranate', variants: [v('500 g', 'g', 500, 95, 85, 70)] },
                        { name: 'Papaya', variants: [v('1 piece (approx. 1 kg)', 'piece', 1, 60, 52, 50)] }
                    ]
                },
                {
                    name: 'Exotic Fruits',
                    products: [
                        { name: 'Kiwi (Imported)', variants: [v('3 pcs', 'piece', 3, 99, 89, 60)] },
                        { name: 'Avocado (Hass)', variants: [v('1 piece', 'piece', 1, 149, 129, 40)] }
                    ]
                }
            ]
        }
    ],

    electronics: [
        {
            name: 'Lighting',
            colors: ['#f59e0b', '#7c2d12'],
            children: [
                {
                    name: 'LED Bulbs',
                    products: [
                        {
                            name: 'Philips 9W LED Bulb (Cool Day Light)', brand: 'Philips', model: 'Stellar Bright 9W B22', featured: true,
                            specs: [['Wattage', '9 W'], ['Base', 'B22'], ['Colour', 'Cool day light, 6500K'], ['Life', '15,000 hours']],
                            warranty: '1 year manufacturer warranty',
                            variants: [v('Single', 'piece', 1, 120, 99, 200), v('Pack of 4', 'pack', 4, 440, 349, 80)]
                        },
                        {
                            name: 'Syska 12W LED Bulb', brand: 'Syska', model: 'SSK-SRL 12W',
                            specs: [['Wattage', '12 W'], ['Base', 'B22'], ['Lumens', '1,200 lm']],
                            warranty: '2 years manufacturer warranty',
                            variants: [v('Single', 'piece', 1, 175, 139, 150)]
                        }
                    ]
                },
                {
                    name: 'Tube Lights & Battens',
                    products: [
                        {
                            name: 'Wipro Garnet 20W LED Batten', brand: 'Wipro', model: 'N10002',
                            specs: [['Wattage', '20 W'], ['Length', '4 ft'], ['Colour', 'Cool day light']],
                            warranty: '2 years manufacturer warranty',
                            variants: [v('4 ft', 'piece', 1, 449, 329, 60)]
                        }
                    ]
                }
            ]
        },
        {
            name: 'Fans',
            colors: ['#06b6d4', '#155e75'],
            products: [
                {
                    name: 'Havells Stealth Air 1200mm Ceiling Fan', brand: 'Havells', model: 'Stealth Air BLDC', featured: true,
                    specs: [['Sweep', '1200 mm'], ['Motor', 'BLDC, 32 W'], ['Speed', '280 RPM'], ['Remote', 'Included']],
                    warranty: '5 years manufacturer warranty',
                    handlingNote: 'Free installation in the service area.',
                    variants: [v('Pearl White', 'piece', 1, 5990, 4799, 20), v('Espresso Brown', 'piece', 1, 5990, 4799, 15)]
                },
                {
                    name: 'Bajaj Frore 400mm Table Fan', brand: 'Bajaj', model: 'Frore TF',
                    specs: [['Sweep', '400 mm'], ['Speeds', '3'], ['Oscillation', 'Yes']],
                    warranty: '2 years manufacturer warranty',
                    variants: [v('White', 'piece', 1, 2290, 1849, 25)]
                }
            ]
        },
        {
            name: 'Switches & Wiring',
            colors: ['#64748b', '#1e293b'],
            products: [
                {
                    name: 'Anchor Roma 6A 1-Way Switch', brand: 'Anchor', model: 'Roma 21011',
                    specs: [['Rating', '6 A, 240 V'], ['Type', '1-way, modular']],
                    variants: [v('Single', 'piece', 1, 75, 62, 300), v('Box of 10', 'box', 10, 720, 590, 50)]
                },
                {
                    name: 'Polycab 1.5 sq mm FR PVC Wire', brand: 'Polycab', model: 'Optima+ 1.5',
                    specs: [['Size', '1.5 sq mm'], ['Length', '90 m'], ['Insulation', 'FR PVC']],
                    warranty: 'Polycab quality guarantee',
                    variants: [v('Red, 90 m', 'piece', 1, 2150, 1699, 20), v('Black, 90 m', 'piece', 1, 2150, 1699, 20)]
                },
                {
                    name: 'Havells 4-Way Extension Board', brand: 'Havells', model: 'EB 4+1',
                    specs: [['Sockets', '4 universal'], ['Cord', '1.5 m'], ['Protection', 'Surge, child shutter']],
                    warranty: '1 year manufacturer warranty',
                    variants: [v('1.5 m cord', 'piece', 1, 699, 549, 60)]
                }
            ]
        },
        {
            name: 'Kitchen Appliances',
            colors: ['#ec4899', '#831843'],
            products: [
                {
                    name: 'Prestige Electric Kettle 1.5 L', brand: 'Prestige', model: 'PKOSS 1.5', featured: true,
                    specs: [['Capacity', '1.5 L'], ['Power', '1500 W'], ['Body', 'Stainless steel']],
                    warranty: '1 year manufacturer warranty',
                    variants: [v('Steel', 'piece', 1, 1295, 799, 40)]
                },
                {
                    name: 'Bajaj Rex 500W Mixer Grinder', brand: 'Bajaj', model: 'Rex 500',
                    specs: [['Power', '500 W'], ['Jars', '3'], ['Speeds', '3 + pulse']],
                    warranty: '2 years manufacturer warranty',
                    variants: [v('3 jars', 'piece', 1, 3400, 2299, 25)]
                }
            ]
        },
        {
            name: 'Mobile Accessories',
            colors: ['#8b5cf6', '#312e81'],
            products: [
                {
                    name: 'Ambrane 20W Fast Charger (Type-C)', brand: 'Ambrane', model: 'ACP-20',
                    specs: [['Output', '20 W PD'], ['Port', 'USB Type-C']],
                    warranty: '6 months manufacturer warranty',
                    variants: [v('White', 'piece', 1, 999, 549, 80)]
                },
                {
                    name: 'boAt Type-C to Type-C Cable 1.5 m', brand: 'boAt', model: 'Deuce 600',
                    specs: [['Length', '1.5 m'], ['Power', '60 W']],
                    warranty: '1 year manufacturer warranty',
                    variants: [v('Black', 'piece', 1, 699, 349, 100)]
                }
            ]
        }
    ]
};

export const LAUNDRY_SERVICES = [
    { name: 'Wash & Fold', description: 'Everyday clothes washed, dried and neatly folded. Priced by weight.', pricingUnit: 'kg', rate: 59, minQty: 3, turnaroundHours: 48 },
    { name: 'Wash & Iron', description: 'Washed, dried and steam ironed, returned on hangers or folded.', pricingUnit: 'kg', rate: 89, minQty: 3, turnaroundHours: 48 },
    { name: 'Steam Ironing', description: 'Crisp steam ironing for washed clothes.', pricingUnit: 'piece', rate: 15, minQty: 5, turnaroundHours: 24 },
    { name: 'Dry Clean – Shirt or Trouser', description: 'Gentle dry cleaning for formal wear.', pricingUnit: 'piece', rate: 99, minQty: 1, turnaroundHours: 72 },
    { name: 'Dry Clean – Saree', description: 'Silk and embroidered sarees cleaned with care.', pricingUnit: 'piece', rate: 249, minQty: 1, turnaroundHours: 72 },
    { name: 'Dry Clean – 2-piece Suit', description: 'Jacket and trousers, pressed and returned on a hanger.', pricingUnit: 'piece', rate: 399, minQty: 1, turnaroundHours: 72 },
    { name: 'Blanket & Duvet', description: 'Deep wash for blankets, quilts and duvets.', pricingUnit: 'piece', rate: 349, minQty: 1, turnaroundHours: 96 }
];

/** Banners: placement 'home' or a module; link resolved by the seed (module, category name or product name). */
export const BANNERS = [
    { placement: 'home', title: 'Groceries in 30 minutes', subtitle: 'Fresh staples, snacks and daily essentials', cta: 'Shop grocery', colors: ['#16a34a', '#064e3b'], icon: 'basket', link: { type: 'module', value: 'grocery' } },
    { placement: 'home', title: 'Farm-fresh every morning', subtitle: 'Vegetables and fruits, picked today', cta: 'Shop fresh', colors: ['#84cc16', '#14532d'], icon: 'leaf', link: { type: 'module', value: 'produce' } },
    { placement: 'home', title: 'Laundry, picked up & delivered', subtitle: 'Wash & fold from ₹59/kg', cta: 'Book a pickup', colors: ['#06b6d4', '#1e3a8a'], icon: 'shirt', link: { type: 'module', value: 'laundry' } },
    { placement: 'home', title: 'Electricals at best prices', subtitle: 'LED bulbs, fans, switches and more', cta: 'Explore', colors: ['#3b82f6', '#1e1b4b'], icon: 'bolt', link: { type: 'module', value: 'electronics' } },
    { placement: 'grocery', title: 'Monthly staples sale', subtitle: 'Up to 20% off atta, rice and dals', cta: 'Stock up', colors: ['#f59e0b', '#9a3412'], icon: 'basket', link: { type: 'category', value: 'Staples' } },
    { placement: 'grocery', title: 'Tea-time favourites', subtitle: 'Biscuits, namkeen and chai', cta: 'Shop snacks', colors: ['#f97316', '#7c2d12'], icon: 'basket', link: { type: 'category', value: 'Snacks & Biscuits' } },
    { placement: 'produce', title: 'Leafy greens, just in', subtitle: 'Palak, methi and fresh herbs', cta: 'Shop greens', colors: ['#22c55e', '#14532d'], icon: 'leaf', link: { type: 'category', value: 'Leafy Greens' } },
    { placement: 'produce', title: 'Fruit basket deals', subtitle: 'Seasonal and exotic fruits', cta: 'Shop fruits', colors: ['#f43f5e', '#881337'], icon: 'leaf', link: { type: 'category', value: 'Fresh Fruits' } },
    { placement: 'laundry', title: 'First pickup on us', subtitle: 'Free pickup and delivery on every booking', cta: 'Book now', colors: ['#0ea5e9', '#1e40af'], icon: 'shirt', link: { type: 'none', value: '' } },
    { placement: 'laundry', title: 'Dry cleaning from ₹99', subtitle: 'Suits, sarees and formal wear', cta: 'See prices', colors: ['#6366f1', '#312e81'], icon: 'shirt', link: { type: 'none', value: '' } },
    { placement: 'electronics', title: 'Beat the heat', subtitle: 'BLDC ceiling fans with free installation', cta: 'Shop fans', colors: ['#06b6d4', '#164e63'], icon: 'bolt', link: { type: 'category', value: 'Fans' } },
    { placement: 'electronics', title: 'Light up for less', subtitle: 'LED bulbs and battens from ₹99', cta: 'Shop lighting', colors: ['#f59e0b', '#78350f'], icon: 'bolt', link: { type: 'category', value: 'Lighting' } }
];

export const OFFER_CARDS = [
    {
        module: 'grocery',
        title: 'Beverages',
        label: 'UP TO',
        discountText: '12% OFF',
        image: '/uploads/offers/beverages.webp',
        backgroundColor: '#D1FAE5',
        link: { type: 'category', value: 'Beverages' },
        sortOrder: 1
    },
    {
        module: 'grocery',
        title: 'Oils & Ghee',
        label: 'UP TO',
        discountText: '10% OFF',
        image: '/uploads/offers/oils-ghee.webp',
        backgroundColor: '#FFEDD5',
        link: { type: 'category', value: 'Oils & Ghee' },
        sortOrder: 2
    },
    {
        module: 'grocery',
        title: 'Staples',
        label: 'UP TO',
        discountText: '10% OFF',
        image: '/uploads/offers/staples.webp',
        backgroundColor: '#FEF3C7',
        link: { type: 'category', value: 'Staples' },
        sortOrder: 3
    },
    {
        module: 'grocery',
        title: 'Dairy',
        label: 'UP TO',
        discountText: '15% OFF',
        image: '/uploads/offers/dairy.webp',
        backgroundColor: '#E0F2FE',
        link: { type: 'category', value: 'Dairy & Breakfast' },
        sortOrder: 4
    },
    {
        module: 'grocery',
        title: 'Snacks',
        label: 'UP TO',
        discountText: '20% OFF',
        image: '/uploads/offers/snacks.webp',
        backgroundColor: '#FEF9C3',
        link: { type: 'category', value: 'Snacks & Biscuits' },
        sortOrder: 5
    },
    {
        module: 'produce',
        title: 'Fresh fruits',
        label: 'UP TO',
        discountText: '15% OFF',
        image: '/uploads/offers/fresh-fruits.webp',
        backgroundColor: '#DCFCE7',
        link: { type: 'category', value: 'Fresh Fruits' },
        sortOrder: 1
    }
];

export const COUPONS = [
    { code: 'WELCOME50', description: '₹50 off your first order above ₹299', type: 'flat', value: 50, minOrder: 299, firstOrderOnly: true, modules: [] },
    { code: 'FRESH10', description: '10% off fresh produce, up to ₹75', type: 'percent', value: 10, maxDiscount: 75, minOrder: 199, modules: ['produce'] },
    { code: 'POWER5', description: '5% off electricals above ₹999, up to ₹500', type: 'percent', value: 5, maxDiscount: 500, minOrder: 999, modules: ['electronics'] }
];

/** Slot rules, every day, for every zone (zone: null). */
export const SLOT_RULES = [
    ...['grocery', 'produce'].flatMap((module) =>
        [['07:00', '10:00'], ['11:00', '14:00'], ['17:00', '20:00']].map(([start, end]) => ({ module, kind: 'delivery', start, end, capacity: 60, cutoffMinutes: 60 }))
    ),
    ...[['10:00', '13:00'], ['15:00', '19:00']].map(([start, end]) => ({ module: 'electronics', kind: 'delivery', start, end, capacity: 30, cutoffMinutes: 120 })),
    ...[['08:00', '11:00'], ['17:00', '20:00']].map(([start, end]) => ({ module: 'laundry', kind: 'pickup', start, end, capacity: 30, cutoffMinutes: 60 })),
    ...[['10:00', '13:00'], ['16:00', '19:00']].map(([start, end]) => ({ module: 'laundry', kind: 'return', start, end, capacity: 30, cutoffMinutes: 60 }))
];
