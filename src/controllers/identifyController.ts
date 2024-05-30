import { Request, Response } from 'express';
import pool from '../db';
import { Contact } from '../models/contact';

export const identifyContact = async (req: Request, res: Response) => {
  const { email, phoneNumber } = req.body;

  try {
    // Find existing contacts by email or phoneNumber
    const existingContactsQuery = `
      SELECT * FROM Contact
      WHERE (email = $1 AND $1 IS NOT NULL)
      OR (phoneNumber = $2 AND $2 IS NOT NULL)
      AND deletedAt IS NULL
    `;
    const existingContactsResult = await pool.query(existingContactsQuery, [email, phoneNumber]);
    const existingContacts: Contact[] = existingContactsResult.rows;

    if (existingContacts.length === 0) {
      // Create new primary contact
      const newContactQuery = `
        INSERT INTO Contact (email, phoneNumber, linkPrecedence)
        VALUES ($1, $2, 'primary')
        RETURNING *
      `;
      const newContactResult = await pool.query(newContactQuery, [email, phoneNumber]);
      const newContact = newContactResult.rows[0];

      return res.status(200).json({
        contact: {
          primaryContactId: newContact.id,
          emails: [newContact.email],
          phoneNumbers: [newContact.phoneNumber],
          secondaryContactIds: []
        }
      });
    }

    // Find primary and secondary contacts
    let primaryContact: Contact | null = null;
    const secondaryContacts: Contact[] = [];

    for (const contact of existingContacts) {
      if (contact.linkPrecedence === 'primary') {
        primaryContact = contact;
      } else {
        secondaryContacts.push(contact);
      }
    }

    // If no primary contact found, find the oldest contact and set as primary
    if (!primaryContact) {
      primaryContact = existingContacts.reduce((oldest, contact) => 
        contact.createdAt < oldest.createdAt ? contact : oldest, existingContacts[0]);
      await pool.query('UPDATE Contact SET linkPrecedence = \'primary\' WHERE id = $1', [primaryContact.id]);
    }

    // Create secondary contact if needed
    if (!existingContacts.some(c => c.email === email && c.phoneNumber === phoneNumber)) {
      const newSecondaryContactQuery = `
        INSERT INTO Contact (email, phoneNumber, linkedId, linkPrecedence)
        VALUES ($1, $2, $3, 'secondary')
        RETURNING *
      `;
      const newSecondaryContactResult = await pool.query(newSecondaryContactQuery, [email, phoneNumber, primaryContact.id]);
      secondaryContacts.push(newSecondaryContactResult.rows[0]);
    }

    const emails = Array.from(new Set([primaryContact.email, ...secondaryContacts.map(c => c.email)].filter(e => e)));
    const phoneNumbers = Array.from(new Set([primaryContact.phoneNumber, ...secondaryContacts.map(c => c.phoneNumber)].filter(p => p)));

    return res.status(200).json({
      contact: {
        primaryContactId: primaryContact.id,
        emails,
        phoneNumbers,
        secondaryContactIds: secondaryContacts.map(c => c.id)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
};
