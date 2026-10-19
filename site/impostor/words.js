// Word packs. Each pack's words should be easy to give clues for and all
// belong to one category, so a decoy word from the same pack sounds plausible.
export const PACKS = [
  {
    id: "food",
    name: "Khana-peena",
    category: "Food & drink",
    words: [
      "Biryani", "Samosa", "Pani Puri", "Masala Dosa", "Idli", "Vada Pav",
      "Pav Bhaji", "Chole Bhature", "Rajma Chawal", "Gulab Jamun", "Jalebi",
      "Rasgulla", "Paneer Tikka", "Butter Chicken", "Dhokla", "Khichdi",
      "Aloo Paratha", "Lassi", "Masala Chai", "Poha", "Upma", "Maggi",
      "Kulfi", "Gajar Halwa", "Besan Ladoo", "Pakoda", "Bhel Puri", "Momos",
      "Sambar", "Dal Makhani", "Kaju Katli", "Nimbu Pani", "Mango Pickle",
      "Thali", "Filter Coffee", "Pulao", "Kheer", "Papad", "Raita", "Golgappa",
    ],
  },
  {
    id: "festivals",
    name: "Tyohaar & functions",
    category: "Festivals & family occasions",
    words: [
      "Diwali", "Holi", "Navratri", "Ganesh Chaturthi", "Eid", "Christmas",
      "Pongal", "Onam", "Raksha Bandhan", "Karva Chauth", "Lohri",
      "Durga Puja", "Baisakhi", "Janmashtami", "Sangeet", "Mehendi", "Haldi",
      "Baraat", "Griha Pravesh", "Mundan", "Bhai Dooj", "Makar Sankranti",
      "Garba", "Dussehra", "Satyanarayan Puja", "Annual Day", "Birthday party",
      "Shaadi reception", "Kitty party", "New Year's Eve",
    ],
  },
  {
    id: "bollywood",
    name: "Bollywood",
    category: "Bollywood movies",
    words: [
      "Sholay", "DDLJ", "3 Idiots", "Lagaan", "Kabhi Khushi Kabhie Gham",
      "Dangal", "PK", "Zindagi Na Milegi Dobara", "Baahubali", "RRR",
      "Hum Aapke Hain Koun", "Kuch Kuch Hota Hai", "Chak De! India",
      "Taare Zameen Par", "Munna Bhai MBBS", "Hera Pheri", "Andaz Apna Apna",
      "Queen", "Jawan", "Om Shanti Om", "Kal Ho Naa Ho", "Jab We Met",
      "Dil Chahta Hai", "Golmaal", "Krrish", "Pathaan", "Mughal-e-Azam",
      "Bajrangi Bhaijaan", "Gully Boy", "Yeh Jawaani Hai Deewani",
    ],
  },
  {
    id: "places",
    name: "Ghoomna-phirna",
    category: "Places in India",
    words: [
      "Taj Mahal", "Goa", "Kerala backwaters", "Manali", "Shimla", "Ladakh",
      "Jaipur", "Varanasi", "Mumbai local", "Marine Drive", "India Gate",
      "Golden Temple", "Mysore Palace", "Ooty", "Darjeeling", "Rishikesh",
      "Kanyakumari", "Andaman", "Hampi", "Gateway of India", "Qutub Minar",
      "Red Fort", "Charminar", "Rann of Kutch", "Munnar", "Tirupati",
      "Vaishno Devi", "Connaught Place", "Howrah Bridge", "Chandni Chowk",
    ],
  },
  {
    id: "home",
    name: "Ghar ki cheezein",
    category: "Things around an Indian home",
    words: [
      "Pressure cooker", "Tiffin box", "Tawa", "Belan", "Steel glass", "Diya",
      "Rangoli", "Pooja room", "Mixer grinder", "Bucket and mug", "Charpai",
      "Ceiling fan", "Inverter", "Masala dabba", "Chappal", "Dupatta",
      "Saree", "Kurta", "Godrej almirah", "Mosquito net", "Hot case",
      "TV remote in plastic", "Agarbatti", "Jhadu", "Old newspaper pile",
      "Plastic bag of plastic bags", "Water purifier", "Calendar from the kirana store",
      "Sofa cover", "Thermos",
    ],
  },
  {
    id: "sports",
    name: "Khel-kood",
    category: "Sports, games & players",
    words: [
      "Sachin Tendulkar", "Virat Kohli", "MS Dhoni", "IPL", "Sixer", "Wicket",
      "Kabaddi", "Kho-kho", "Gully cricket", "Carrom", "Ludo", "Chess",
      "Badminton", "Hockey", "Kite flying", "Antakshari", "Neeraj Chopra",
      "PV Sindhu", "Rohit Sharma", "World Cup", "Snakes and Ladders",
      "Gilli-danda", "Pithu", "Business (board game)", "Cycle race",
      "Kapil Dev", "Hide and seek", "Langdi", "Lagori", "Teen Patti",
    ],
  },
  {
    id: "daily",
    name: "Roz ki zindagi",
    category: "Everyday Indian life",
    words: [
      "Auto-rickshaw", "Chaiwala", "Traffic jam", "Power cut", "Monsoon",
      "Board exams", "Tuition class", "Doodhwala", "Sabziwala", "Kirana store",
      "WhatsApp family group", "Railway platform", "Wedding buffet queue",
      "Relatives asking about marks", "Bargaining", "Morning walk",
      "Yoga class", "Temple bells", "Cricket on TV", "Sunday breakfast",
      "Summer vacation at Nani's", "School bus", "Lunch break", "Daily soap",
      "Honking", "Petrol pump", "Aadhaar card", "ATM queue", "Mehndi cone",
      "Cooler",
    ],
  },
];

// Ways the group must give clues in a round, when "clue styles" is on.
export const CLUE_STYLES = [
  { title: "Normal", text: "One word each. Keep it subtle!" },
  { title: "Dumb charades", text: "Act out your clue. No talking at all!" },
  { title: "Sound effects", text: "Your clue must be a sound. No real words." },
  { title: "Teen shabd", text: "Your clue must be exactly three words." },
  { title: "Filmy", text: "Say your clue like a Bollywood dialogue." },
  { title: "Matrubhasha", text: "Give your clue in Hindi or your mother tongue." },
  { title: "Tukbandi", text: "Your clue has to rhyme with the previous player's clue." },
  { title: "Nani style", text: "Describe it the way Nani or Dadi would." },
  { title: "Emoji face", text: "Make a face that is your clue. No sounds." },
  { title: "Antakshari", text: "Your clue must start with the last letter of the previous clue." },
];
